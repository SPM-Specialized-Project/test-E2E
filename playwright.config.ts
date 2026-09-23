import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  webServer: [
    {
      command: 'cd ../spm && npm run backend',
      url: 'http://127.0.0.1:4000/api/health',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'cd ../spm/frontend && npm run dev -- --host 127.0.0.1 --strictPort',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
      timeout: 180000,
    },
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
