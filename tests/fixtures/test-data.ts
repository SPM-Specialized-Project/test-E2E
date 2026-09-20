import { expect, type Page } from '@playwright/test';

export const testAccounts = {
  student: {
    email: 'student@gmail.com',
    password: 'student123',
  },
  tutor: {
    email: 'tutor@gmail.com',
    password: 'tutor123',
  },
} as const;

export async function loginAs(
  page: Page,
  account: (typeof testAccounts)[keyof typeof testAccounts],
) {
  await page.goto('/login');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
}
