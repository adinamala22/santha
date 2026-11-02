import { defineConfig, devices } from '@playwright/test';

/**
 * Console e2e against the fake backend (DATA_STORE=memory) — no Docker (santha-web skill).
 * `pnpm --filter web e2e` starts both servers unless they are already running.
 * Local runs can use the installed Chrome: PW_CHANNEL=chrome.
 */
const backend = 'http://localhost:4000';
const web = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // the fake store is shared state; tests run in order
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: web,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: [
    {
      command: 'pnpm --filter backend start:fake', // no --watch: it needs a .env file to exist
      url: `${backend}/v1/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter web dev',
      url: `${web}/admin/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      cwd: '../..',
      env: { API_URL: backend },
    },
  ],
});
