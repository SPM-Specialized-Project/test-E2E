// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loginMock, navigateMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => navigateMock,
}));

vi.mock('@/services/api-client', () => ({
  api: { login: loginMock },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/stores', () => ({
  useAuthStore: (selector: (state: { setToken: () => void }) => unknown) =>
    selector({ setToken: vi.fn() }),
  useUserStore: (selector: (state: { setUser: () => void }) => unknown) =>
    selector({ setUser: vi.fn() }),
}));

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RouteComponent } from '@/features/~login/~index';

describe('US-001.1 - login required fields', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    loginMock.mockReset();
    navigateMock.mockReset();
  });

  it('renders the login view once and shows both required messages without sending a request', () => {
    render(<RouteComponent />);

    expect(screen.getAllByRole('heading', { name: 'ĐĂNG NHẬP' })).toHaveLength(1);

    fireEvent.submit(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(screen.getByText('Vui lòng nhập email')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập mật khẩu')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('logs in with valid credentials and navigates to the dashboard', async () => {
    loginMock.mockResolvedValue({
      data: {
        accessToken: 'token-1',
        role: 'student',
        user: { email: 'student@example.com' },
      },
    });

    render(<RouteComponent />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Đăng nhập' }));

    await vi.waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith({
        email: 'student@example.com',
        password: 'password123',
      });
      expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' });
    });
  });
});