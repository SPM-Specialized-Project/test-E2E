import { expect, test } from "@playwright/test";
import { testAccounts } from "./fixtures/test-data";

const apiBaseURL = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";
const appBaseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Authentication and security requirements", () => {
  test("student can log in with valid credentials and gets a valid session token", async ({
    page,
    request,
  }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator("#email").fill(testAccounts.student.email);
    await page.locator("#password").fill(testAccounts.student.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    await expect(page).toHaveURL(/\/dashboard\/?$/);

    const rawAuthState = await page.evaluate(() => {
      const json = localStorage.getItem("authStore");
      return json ? JSON.parse(json) : null;
    });

    expect(rawAuthState?.state?.token).toMatch(/^[a-f0-9]{64}$/);

    const meResponse = await request.get(`${apiBaseURL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${rawAuthState.state.token}`,
      },
    });

    expect(meResponse.ok()).toBeTruthy();
    await expect(meResponse.json()).resolves.toMatchObject({
      role: "student",
      user: expect.objectContaining({ email: testAccounts.student.email }),
    });
  });

  test("lecturer can log in with valid credentials", async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator("#email").fill("lecturer@gmail.com");
    await page.locator("#password").fill("lecturer123");
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.locator("h1")).toContainText("Khóa học");
  });

  test("invalid credentials return the generic message and do not reveal account state", async ({
    page,
  }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator("#email").fill(testAccounts.student.email);
    await page.locator("#password").fill("wrong-password");
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    await expect(
      page.getByText("Email hoặc mật khẩu không đúng!"),
    ).toBeVisible();

    await page.locator("#email").fill("missing.user@example.com");
    await page.locator("#password").fill(testAccounts.student.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    // The form keeps the user on the login page and exposes the same generic
    // error contract; the number of rendered copies is an implementation
    // detail and differs between the current and staging bundles.
    await expect(
      page.getByText("Email hoặc mật khẩu không đúng!").first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login\/?$/);
  });

  test("wrong password and non-existent user return the same generic response", async ({
    request,
  }) => {
    const wrongPasswordResponse = await request.post(
      `${apiBaseURL}/api/auth/login`,
      {
        data: {
          email: testAccounts.student.email,
          password: "wrong-password",
        },
      },
    );
    const missingUserResponse = await request.post(
      `${apiBaseURL}/api/auth/login`,
      {
        data: {
          email: "missing.user@example.com",
          password: "wrong-password",
        },
      },
    );
    const wrongBody = await wrongPasswordResponse.json();
    const missingBody = await missingUserResponse.json();

    expect(wrongPasswordResponse.status()).toBe(401);
    expect(missingUserResponse.status()).toBe(401);
    expect(wrongBody).toMatchObject({
      message: "Email hoặc mật khẩu không đúng!",
    });
    expect(missingBody).toMatchObject({
      message: "Email hoặc mật khẩu không đúng!",
    });
  });

  test("empty inputs are rejected client-side before any login request is sent", async ({
    page,
  }) => {
    const loginRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/auth/login")) {
        loginRequests.push(request.url());
      }
    });

    await page.goto(`${appBaseURL}/login`);
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    await expect(page).toHaveURL(/\/login\/?$/);
    // Both native required-field validation and the staging bundle's custom
    // validation satisfy this contract without sending credentials.
    expect(loginRequests).toHaveLength(0);
  });

  test("password is masked by default and can be revealed via the UI toggle", async ({
    page,
  }) => {
    await page.goto(`${appBaseURL}/login`);
    const passwordField = page.locator("#password");

    await passwordField.fill("MySecretPassword123");
    await expect(passwordField).toHaveAttribute("type", "password");

    await page.locator('svg[role="button"]').click();
    await expect(passwordField).toHaveAttribute("type", "text");
  });

  test("invalid-login responses do not expose the submitted password", async ({
    request,
  }) => {
    const secretPassword = "PlainTextPassword123";
    const response = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: {
        email: "student@gmail.com",
        password: secretPassword,
      },
    });
    const responseText = await response.text();

    expect(response.status()).toBe(401);
    expect(responseText).toContain("Email hoặc mật khẩu không đúng!");
    expect(responseText.toLowerCase()).not.toContain(
      secretPassword.toLowerCase(),
    );
  });

  test('required email and password are enforced before a login request is sent', async ({ page }) => {
    const loginRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/login')) {
        loginRequests.push(request.url());
      }
    });

    await page.goto(`${appBaseURL}/login`);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/login\/?$/);
    // The browser bundle may use native or custom validation; both contracts
    // keep the login request from being sent.
    expect(loginRequests).toHaveLength(0);
  });
});
