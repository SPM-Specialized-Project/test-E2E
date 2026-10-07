import { expect, test } from '@playwright/test';

import { appBaseURL } from './fixtures/target-host';

test.describe('US-002.1 - dashboard course list', () => {
  test('displays the dashboard and the available course', async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator('#email').fill('student@gmail.com');
    await page.locator('#password').fill('student123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.getByRole('heading', { name: 'Khóa học' })).toBeVisible();
    await expect(page.getByText('Danh sách khóa học của bạn')).toBeVisible();
    await expect(page.getByText('Computer Network', { exact: true })).toBeVisible();
    await expect(page.getByText('Database System', { exact: true })).toBeVisible();
  });
});