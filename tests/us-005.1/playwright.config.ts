import { defineConfig } from '@playwright/test';

import { appBaseURL } from '../fixtures/target-host';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: appBaseURL,
    trace: 'retain-on-failure',
  },
});
