import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { testAccounts } from './fixtures/test-data';

const apiBaseURL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const appBaseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backendRoot = path.join(projectRoot, 'spm', 'backend');
const backendEntry = path.join(backendRoot, 'server.mjs');

async function waitForBackend(port: number) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry until the backend is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Backend on port ${port} did not start in time`);
}

async function withCapturedBackendLogs(password: string) {
  const port = 4100;
  const child = spawn(process.execPath, [backendEntry], {
    cwd: backendRoot,
    env: {
      ...process.env,
      BACKEND_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logChunks: string[] = [];
  child.stdout.on('data', (chunk) => logChunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logChunks.push(chunk.toString()));

  try {
    await waitForBackend(port);

    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'student@gmail.com',
        password,
      }),
    });

    const payload = await response.json();
    return {
      response,
      payload,
      logText: logChunks.join(''),
    };
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

test.describe('Authentication and security requirements', () => {
  test('student can log in with valid credentials and gets a valid session token', async ({ page, request }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator('#email').fill(testAccounts.student.email);
    await page.locator('#password').fill(testAccounts.student.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/dashboard\/?$/);

    const rawAuthState = await page.evaluate(() => {
      const json = localStorage.getItem('authStore');
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
      role: 'student',
      user: expect.objectContaining({ email: testAccounts.student.email }),
    });
  });

  test('lecturer can log in with valid credentials', async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator('#email').fill('lecturer@gmail.com');
    await page.locator('#password').fill('lecturer123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.locator('h1')).toContainText('Khóa học');
  });

  test('invalid credentials return the generic message and do not reveal account state', async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator('#email').fill(testAccounts.student.email);
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText('Email hoặc mật khẩu không đúng!')).toBeVisible();

    await page.locator('#email').fill('missing.user@example.com');
    await page.locator('#password').fill(testAccounts.student.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText('Email hoặc mật khẩu không đúng!')).toHaveCount(2);
    await expect(page).toHaveURL(/\/login\/?$/);
  });

  test('wrong password and non-existent user return the same message with near-identical timing', async ({ request }) => {
    const wrongPasswordStart = Date.now();
    const wrongPasswordResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: {
        email: testAccounts.student.email,
        password: 'wrong-password',
      },
    });
    const wrongPasswordTime = Date.now() - wrongPasswordStart;

    const missingUserStart = Date.now();
    const missingUserResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: {
        email: 'missing.user@example.com',
        password: 'wrong-password',
      },
    });
    const missingUserTime = Date.now() - missingUserStart;

    const wrongBody = await wrongPasswordResponse.json();
    const missingBody = await missingUserResponse.json();

    expect(wrongPasswordResponse.status()).toBe(401);
    expect(missingUserResponse.status()).toBe(401);
    expect(wrongBody).toMatchObject({ message: 'Email hoặc mật khẩu không đúng!' });
    expect(missingBody).toMatchObject({ message: 'Email hoặc mật khẩu không đúng!' });
    expect(Math.abs(wrongPasswordTime - missingUserTime)).toBeLessThan(200);
  });

  test('empty inputs are rejected client-side before any login request is sent', async ({ page }) => {
    const loginRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/login')) {
        loginRequests.push(request.url());
      }
    });

    await page.goto(`${appBaseURL}/login`);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/login\/?$/);
    await expect.poll(() => page.locator('#email').evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
    await expect.poll(() => page.locator('#password').evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
    expect(loginRequests).toHaveLength(0);
  });

  test('password is masked by default and can be revealed via the UI toggle', async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    const passwordField = page.locator('#password');

    await passwordField.fill('MySecretPassword123');
    await expect(passwordField).toHaveAttribute('type', 'password');

    await page.locator('svg[role="button"]').click();
    await expect(passwordField).toHaveAttribute('type', 'text');
  });

  test('passwords are not logged in plain text in the server logs', async () => {
    const secretPassword = 'PlainTextPassword123';
    const { payload, logText } = await withCapturedBackendLogs(secretPassword);

    expect(payload.message).toBe('Email hoặc mật khẩu không đúng!');
    expect(logText.toLowerCase()).not.toContain(secretPassword.toLowerCase());
  });
});
