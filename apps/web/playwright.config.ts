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
      // Every test signs in (ops + merchant OTPs from one IP): relax the fake backend's OTP limits.
      env: { OTP_RESEND_COOLDOWN_SEC: '0', OTP_LIMIT_PER_PHONE_HOUR: '1000', OTP_LIMIT_PER_DEVICE_HOUR: '1000', OTP_LIMIT_PER_IP_HOUR: '10000', OPS_LOGIN_LIMIT_PER_EMAIL_HOUR: '1000', OPS_LOGIN_LIMIT_PER_IP_HOUR: '1000' },
    },
    {
      // A production build: stable under a long suite (dev-mode compile workers can crash) and closer
      // to what ships. Locally a running `pnpm dev` on :3000 is reused instead.
      command: 'pnpm --filter web build && pnpm --filter web start',
      url: `${web}/admin/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 420_000,
      cwd: '../..',
      env: { API_URL: backend },
    },
  ],
});
