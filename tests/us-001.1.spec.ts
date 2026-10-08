import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testAccounts } from './fixtures/test-data';
import { apiBaseURL, appBaseURL } from './fixtures/target-host';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.resolve(
  process.env.SPM_E2E_BACKEND_ROOT?.trim() || path.join(projectRoot, 'spm', 'backend'),
);
const backendEntry = path.join(backendRoot, 'server.mjs');

async function withCapturedBackendLogs(password: string) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'spm-password-log-'));
  const child = spawn(process.execPath, [backendEntry], {
    cwd: backendRoot,
    env: {
      ...process.env,
      BACKEND_PORT: '0',
      BACKEND_DATA_DIRECTORY: dataDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logChunks: string[] = [];
  child.stdout.on('data', (chunk) => logChunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logChunks.push(chunk.toString()));

  const stopped = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
  });

  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Password-log backend startup timed out.')), 15_000);
      const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', (code) => fail(new Error(`Password-log backend exited: ${code}`)));
      child.stdout.on('data', () => {
        const match = logChunks.join('').match(/localhost:(\d+)/);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testAccounts.student.email,
        password,
      }),
    });
    const payload = await response.json();

    child.kill('SIGTERM');
    await stopped;

    return { response, payload, logText: logChunks.join('') };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
    await stopped;
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

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
    await page.locator('#email').fill(testAccounts.student.email);
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText('Email hoặc mật khẩu không đúng!')).toBeVisible();

    await page.locator('#email').fill('missing.user@example.com');
    await page.locator('#password').fill(testAccounts.student.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText('Email hoặc mật khẩu không đúng!')).toBeVisible();
    await expect(page).toHaveURL(/\/login\/?$/);
  });

  test('wrong password and non-existent user return the same generic response', async ({ request }) => {
    const wrongPasswordResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: {
        email: testAccounts.student.email,
        password: 'wrong-password',
      },
    });
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
    await expect(page.getByText('Vui lòng nhập email')).toBeVisible();
    await expect(page.getByText('Vui lòng nhập mật khẩu')).toBeVisible();
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

  test('checked-out backend does not log submitted passwords in plain text', async () => {
    const secretPassword = 'PlainTextPassword123';
    const { response, payload, logText } = await withCapturedBackendLogs(secretPassword);

    expect(response.status).toBe(401);
    expect(payload.message).toBe("Email hoặc mật khẩu không đúng!");
    expect(logText.toLowerCase()).not.toContain(
      secretPassword.toLowerCase(),
    );
  });
});
