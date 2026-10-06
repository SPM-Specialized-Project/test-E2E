import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendPort = 4100;
const frontendPort = 4300;
const testDataDirectory = path.join(os.tmpdir(), 'spm-scrum-63-e2e');
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  globalSetup: './fixtures/global-setup.ts',
  globalTeardown: './fixtures/global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node backend/server.mjs',
      cwd: projectDirectory,
      url: `http://127.0.0.1:${backendPort}/api/health`,
      env: {
        BACKEND_PORT: String(backendPort),
        BACKEND_DATA_DIRECTORY: testDataDirectory,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm --prefix frontend run dev -- --host 127.0.0.1`,
      cwd: projectDirectory,
      url: `http://127.0.0.1:${frontendPort}`,
      env: {
        VITE_FRONTEND_PORT: String(frontendPort),
        VITE_BACKEND_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
