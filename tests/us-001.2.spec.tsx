// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { expect as expectPlaywright, test as playwrightTest } from '@playwright/test';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe as describeVitest, expect as expectVitest, it as itVitest, vi } from 'vitest';

const { ApiErrorMock, loginMock, navigateMock } = vi.hoisted(() => ({
  ApiErrorMock: class ApiErrorMock extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  loginMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => navigateMock,
}));

vi.mock('@/services/api-client', () => ({
  api: { login: loginMock },
  ApiError: ApiErrorMock,
}));

vi.mock('@/stores', () => ({
  useAuthStore: (selector: (state: { setToken: () => void }) => unknown) =>
    selector({ setToken: vi.fn() }),
  useUserStore: (selector: (state: { setUser: () => void }) => unknown) =>
    selector({ setUser: vi.fn() }),
}));

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RouteComponent } from '@/features/~login/~index';

describeVitest('US-001.2 - invalid login credentials', () => {
  beforeEach(() => {
    loginMock.mockReset();
    navigateMock.mockReset();
  });

  itVitest('shows invalid credential messages and stays on the login page', async () => {
    loginMock.mockRejectedValue(
      new ApiErrorMock('Thông tin đăng nhập không đúng', 'INVALID_CREDENTIALS'),
    );

    render(<RouteComponent />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'wrong@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Đăng nhập' }));

    await vi.waitFor(() => {
      expectVitest(screen.getByText('sai tên người dùng')).toBeInTheDocument();
      expectVitest(screen.getByText('sai mật khẩu')).toBeInTheDocument();
    });
    expectVitest(navigateMock).not.toHaveBeenCalled();
  });
});

const apiBaseURL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';

async function login(request: Parameters<typeof playwrightTest>[0]['request'], email: string, password: string) {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { email, password },
  });

  expectPlaywright(response.ok()).toBeTruthy();
  const payload = await response.json();
  expectPlaywright(payload.accessToken).toBeTruthy();
  return payload.accessToken as string;
}

playwrightTest.describe('US-001.2 authorization boundary tests', () => {
  playwrightTest('student cannot access lecturer dashboard and receives sanitized test-case data', async ({ request }) => {
    const studentToken = await login(request, 'student@gmail.com', 'student123');

    const dashboardResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expectPlaywright(dashboardResponse.status()).toBe(403);

    const problemResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1/problems/problem-1`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expectPlaywright(problemResponse.status()).toBe(200);

    const payload = await problemResponse.json();
    expectPlaywright(payload.item.testCases).toHaveLength(1);
    expectPlaywright(payload.item.testCases[0].id).toBe('public-1');
    expectPlaywright(payload.item.testCases.every((testCase) => !testCase.hidden)).toBeTruthy();
    expectPlaywright(payload.item.rawRunnerTrace).toBeUndefined();
    expectPlaywright(JSON.stringify(payload)).not.toContain('secret input');
  });

  playwrightTest('lecturer cannot edit another student workspace through the API', async ({ request }) => {
    const lecturerToken = await login(request, 'lecturer@gmail.com', 'lecturer123');

    const response = await request.patch(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${lecturerToken}` },
      data: {
        sourceCode: 'print("hacked")',
      },
    });

    expectPlaywright(response.status()).toBe(403);
  });

  playwrightTest('student cannot access foreign workspace and is_admin payload has no effect on permissions', async ({ request }) => {
    const studentToken = await login(request, 'student@gmail.com', 'student123');

    const foreignWorkspaceResponse = await request.get(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expectPlaywright(foreignWorkspaceResponse.status()).toBe(403);

    const privilegeEscalationResponse = await request.patch(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: {
        sourceCode: 'print("admin")',
        is_admin: true,
      },
    });

    expectPlaywright(privilegeEscalationResponse.status()).toBe(403);
  });

  playwrightTest('revoked membership blocks the next API request immediately', async ({ request }) => {
    const adminToken = await login(request, 'admin@gmail.com', 'admin123');
    const student2Token = await login(request, 'student2@gmail.com', 'student2123');

    const revokeResponse = await request.patch(`${apiBaseURL}/api/codepulse/memberships/member-2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'revoked' },
    });
    expectPlaywright(revokeResponse.status()).toBe(200);

    const blockedWorkspaceResponse = await request.get(`${apiBaseURL}/api/codepulse/workspaces/workspace-2`, {
      headers: { Authorization: `Bearer ${student2Token}` },
    });
    expectPlaywright(blockedWorkspaceResponse.status()).toBe(403);

    const blockedClassroomResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1`, {
      headers: { Authorization: `Bearer ${student2Token}` },
    });
    expectPlaywright(blockedClassroomResponse.status()).toBe(403);
  });
});