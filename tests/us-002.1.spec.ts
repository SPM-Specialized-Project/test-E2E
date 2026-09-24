import { expect, test } from '@playwright/test';

const appBaseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

test.describe('US-002.1 - dashboard course list', () => {
  test('displays the dashboard and the available course', async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator('#email').fill('student@gmail.com');
    await page.locator('#password').fill('student123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.getByRole('heading', { name: 'Khóa học' })).toBeVisible();
    await expect(page.getByText('Danh sách khóa học của bạn')).toBeVisible();
    await expect(page.getByText('Lập trình cơ bản')).toBeVisible();
    await expect(page.getByText('CS101')).toBeVisible();
  });
});