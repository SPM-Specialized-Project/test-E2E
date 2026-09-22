import { expect, test } from '@playwright/test';

const apiBaseURL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';

async function login(request: Parameters<typeof test>[0]['request'], email: string, password: string) {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { email, password },
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.accessToken).toBeTruthy();
  return payload.accessToken as string;
}

test.describe('US-001.2 authorization boundary tests', () => {
  test('student cannot access lecturer dashboard and receives sanitized test-case data', async ({ request }) => {
    const studentToken = await login(request, 'student@gmail.com', 'student123');

    const dashboardResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(dashboardResponse.status()).toBe(403);

    const problemResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1/problems/problem-1`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(problemResponse.status()).toBe(200);

    const payload = await problemResponse.json();
    expect(payload.item.testCases).toHaveLength(1);
    expect(payload.item.testCases[0].id).toBe('public-1');
    expect(payload.item.testCases.every((testCase) => !testCase.hidden)).toBeTruthy();
    expect(payload.item.rawRunnerTrace).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('secret input');
  });

  test('lecturer cannot edit another student workspace through the API', async ({ request }) => {
    const lecturerToken = await login(request, 'lecturer@gmail.com', 'lecturer123');

    const response = await request.patch(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${lecturerToken}` },
      data: {
        sourceCode: 'print("hacked")',
      },
    });

    expect(response.status()).toBe(403);
  });

  test('student cannot access foreign workspace and is_admin payload has no effect on permissions', async ({ request }) => {
    const studentToken = await login(request, 'student@gmail.com', 'student123');

    const foreignWorkspaceResponse = await request.get(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(foreignWorkspaceResponse.status()).toBe(403);

    const privilegeEscalationResponse = await request.patch(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: {
        sourceCode: 'print("admin")',
        is_admin: true,
      },
    });

    expect(privilegeEscalationResponse.status()).toBe(403);
  });

  test('revoked membership blocks the next API request immediately', async ({ request }) => {
    const adminToken = await login(request, 'admin@gmail.com', 'admin123');
    const student2Token = await login(request, 'student2@gmail.com', 'student2123');

    const revokeResponse = await request.patch(`${apiBaseURL}/api/codepulse/memberships/member-2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'revoked' },
    });
    expect(revokeResponse.status()).toBe(200);

    const blockedWorkspaceResponse = await request.get(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${student2Token}` },
    });
    expect(blockedWorkspaceResponse.status()).toBe(403);

    const blockedClassroomResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1`, {
      headers: { Authorization: `Bearer ${student2Token}` },
    });
    expect(blockedClassroomResponse.status()).toBe(403);
  });
});
