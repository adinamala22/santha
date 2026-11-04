import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * The same suite against a deployed environment (docs/testing/e2e.md). Default: test (https://test.santhaapp.com).
 *   pnpm --filter web e2e:live                       # test
 *   E2E_WEB_URL=… E2E_API_URL=… pnpm --filter web e2e:live
 * Ops console specs need E2E_OPS_EMAIL / E2E_OPS_PASSWORD (the QA ops user; GitHub secrets in CI).
 * Runs only specs written to be safe and repeatable on a shared server: smoke/, journeys/, features/.
 * The older console specs depend on fresh fake data and stay fake-only.
 */
// Local runs: the QA ops login from apps/web/.env.e2e.local (git-ignored), unless already set (CI secrets).
// pnpm --filter web runs in apps/web; also works from the repo root.
const local = [resolve('.env.e2e.local'), resolve('apps/web/.env.e2e.local')].find((f) => existsSync(f));
if (local)
  for (const line of readFileSync(local, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]!] ??= m[2]!;
  }

process.env.E2E_TARGET ??= 'live';
process.env.E2E_API_URL ??= 'https://api.test.santhaapp.com';
const web = process.env.E2E_WEB_URL ?? 'https://test.santhaapp.com';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['smoke/**/*.spec.ts', 'journeys/**/*.spec.ts', 'features/**/*.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]],
  use: {
    baseURL: web,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.E2E_VIDEO ? 'on' : 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
    channel: process.env.PW_CHANNEL || undefined,
  },
});
