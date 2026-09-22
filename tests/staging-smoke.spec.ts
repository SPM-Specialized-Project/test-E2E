import { expect, test } from '@playwright/test';

import { loginAs, testAccounts } from './fixtures/test-data';

const apiBaseURL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';

test.describe('SPM staging smoke', () => {
  test('backend health endpoint is available', async ({ request }) => {
    const response = await request.get(`${apiBaseURL}/api/health`);

    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: 'spm-backend',
    });
  });

  test('student can authenticate and see the course dashboard', async ({ page }) => {
    await loginAs(page, testAccounts.student);

    await expect(page.locator('h1')).toContainText('Khóa học');
    await expect(page.getByText('Computer Network', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Database System', { exact: true }).first()).toBeVisible();
  });

  test('student can open a course and load backend-backed details', async ({ page }) => {
    await loginAs(page, testAccounts.student);

    await page.getByText('Computer Network', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/course\/1\/?$/);
    await expect(page.getByText('Computer Network', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Đang tải dữ liệu khóa học...', { exact: true })).toBeHidden();
  });

  test('invalid credentials are rejected', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(testAccounts.student.email);
    await page.locator('#password').fill('wrong-password');

    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/login') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    expect((await loginResponse).status()).toBe(401);
    await expect(page).toHaveURL(/\/login\/?$/);
    await expect(page.getByText('Email hoặc mật khẩu không đúng!', { exact: true })).toBeVisible();
  });
});
