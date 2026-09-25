import { expect, test } from "@playwright/test";

const apiBaseURL = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";

async function login(
  request: Parameters<typeof test>[0]["request"],
  email: string,
  password: string,
) {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { email, password },
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.accessToken).toBeTruthy();
  return payload.accessToken as string;
}

async function setCodePulseMembershipStatus(
  request: Parameters<typeof test>[0]["request"],
  adminToken: string,
  membershipId: string,
  status: "active" | "revoked",
) {
  const response = await request.patch(
    `${apiBaseURL}/api/codepulse/memberships/${membershipId}`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status },
    },
  );
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(String(payload.item.status).toLowerCase()).toBe(status);
}

async function resetCodePulseMemberships(
  request: Parameters<typeof test>[0]["request"],
) {
  const adminToken = await login(request, "admin@gmail.com", "admin123");
  await setCodePulseMembershipStatus(request, adminToken, "member-1", "active");
  await setCodePulseMembershipStatus(request, adminToken, "member-2", "active");
}

test.describe("US-001.2 authorization boundary tests", () => {
  test.beforeEach(async ({ request }) => {
    await resetCodePulseMemberships(request);
  });

  test.afterEach(async ({ request }) => {
    await resetCodePulseMemberships(request);
  });

  test("student cannot access lecturer dashboard and receives sanitized test-case data", async ({
    request,
  }) => {
    const studentToken = await login(
      request,
      "student@gmail.com",
      "student123",
    );

    const dashboardResponse = await request.get(
      `${apiBaseURL}/api/codepulse/classrooms/class-1/dashboard`,
      {
        headers: { Authorization: `Bearer ${studentToken}` },
      },
    );
    expect(dashboardResponse.status()).toBe(403);

    const problemResponse = await request.get(
      `${apiBaseURL}/api/codepulse/classrooms/class-1/problems/problem-1`,
      {
        headers: { Authorization: `Bearer ${studentToken}` },
      },
    );
    const payload = await problemResponse.json();
    expect(problemResponse.status()).toBe(200);
    expect(payload.item.testCases).toHaveLength(1);
    expect(payload.item.testCases[0].id).toBe("public-1");
    expect(
      payload.item.testCases.every((testCase) => !testCase.hidden),
    ).toBeTruthy();
    expect(payload.item.rawRunnerTrace).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("secret input");
  });

  test("lecturer cannot edit another student workspace through the API", async ({
    request,
  }) => {
    const lecturerToken = await login(
      request,
      "lecturer@gmail.com",
      "lecturer123",
    );

    const response = await request.patch(
      `${apiBaseURL}/api/codepulse/workspaces/workspace-2`,
      {
        headers: { Authorization: `Bearer ${lecturerToken}` },
        data: {
          sourceCode: 'print("hacked")',
        },
      },
    );

    expect(response.status()).toBe(403);
  });

  test("student cannot access foreign workspace and is_admin payload has no effect on permissions", async ({
    request,
  }) => {
    const studentToken = await login(
      request,
      "student@gmail.com",
      "student123",
    );

    const foreignWorkspaceResponse = await request.get(
      `${apiBaseURL}/api/codepulse/workspaces/workspace-2`,
      {
        headers: { Authorization: `Bearer ${studentToken}` },
      },
    );
    expect(foreignWorkspaceResponse.status()).toBe(403);

    const privilegeEscalationResponse = await request.patch(
      `${apiBaseURL}/api/codepulse/workspaces/workspace-2`,
      {
        headers: { Authorization: `Bearer ${studentToken}` },
        data: {
          sourceCode: 'print("admin")',
          is_admin: true,
        },
      },
    );

    expect(privilegeEscalationResponse.status()).toBe(403);
  });

  test("revoked membership blocks the next API request immediately", async ({
    request,
  }) => {
    const adminToken = await login(request, "admin@gmail.com", "admin123");
    const studentToken = await login(
      request,
      "student@gmail.com",
      "student123",
    );

    await setCodePulseMembershipStatus(
      request,
      adminToken,
      "member-1",
      "revoked",
    );

    const blockedWorkspaceResponse = await request.get(
      `${apiBaseURL}/api/codepulse/workspaces/workspace-1`,
      {
        headers: { Authorization: `Bearer ${studentToken}` },
      },
    );
    expect(blockedWorkspaceResponse.status()).toBe(403);

    const blockedClassroomResponse = await request.get(
      `${apiBaseURL}/api/codepulse/classrooms/class-1`,
      {
        headers: { Authorization: `Bearer ${studentToken}` },
      },
    );
    expect(blockedClassroomResponse.status()).toBe(403);
  });

  test('invalid login credentials display inline errors and keep the user on the login page', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:3000'}/login`);
    await page.locator('#email').fill('wrong@example.com');
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(
      page.getByText('Email hoặc mật khẩu không đúng!').first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login\/?$/);
  });
});
