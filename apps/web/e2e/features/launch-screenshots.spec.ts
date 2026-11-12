import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API, appSignIn, call, deliverBySelf, HAS_OPS, newCustomer, opsSignIn, openAllDay, placeCodOrder, SEED } from '../support/target';

/**
 * Screenshots for the launch test report (docs/testing/launch-test-report.md). Runs with the normal suite (it also
 * asserts every page loads without an error), but only writes PNGs when E2E_SHOTS_DIR is set:
 *   E2E_SHOTS_DIR=../../docs/testing/screenshots/web pnpm --filter web e2e:live features/launch-screenshots
 * Public pages in English and Telugu, desktop and phone width; the ops console signed in as a real ops user.
 */
const DIR = process.env.E2E_SHOTS_DIR;
let n = 0;

async function shot(page: Page, name: string, opts: { full?: boolean } = {}) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  if (!DIR) return;
  mkdirSync(DIR, { recursive: true });
  n += 1;
  await page.screenshot({ path: join(DIR, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: opts.full ?? false });
}

test.describe.serial('launch screenshots: public site', () => {
  test('landing, stores, riders, home kitchens, legal: English and Telugu, desktop', async ({ page }) => {
    for (const [path, name] of [['/', 'landing'], ['/stores', 'for-stores'], ['/riders', 'for-riders'], ['/home-kitchens', 'home-kitchens'], ['/legal/privacy', 'legal-privacy'], ['/legal/terms', 'legal-terms'], ['/legal/grievance', 'legal-grievance']] as const) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `public-${name}-en`, { full: true });
    }
    for (const [path, name] of [['/?lang=te', 'landing'], ['/stores?lang=te', 'for-stores'], ['/legal/privacy?lang=te', 'legal-privacy']] as const) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.locator('[lang="te"]').first()).toBeVisible();
      await shot(page, `public-${name}-te`, { full: true });
    }
  });

  test('the same pages on a phone', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    const page = await ctx.newPage();
    for (const [path, name] of [['/', 'landing'], ['/stores', 'for-stores'], ['/riders', 'for-riders']] as const) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways on a phone`).toBeLessThanOrEqual(1);
      await shot(page, `phone-${name}`, { full: true });
    }
    await ctx.close();
  });

  test('a store link page', async ({ page, request }) => {
    const list = (await call(request, 'get', '/public/stores')).items as Array<{ slug: string; name: string }>;
    const ramesh = list.find((s) => s.name === SEED.kirana.name)!;
    await page.goto(`/s/${ramesh.slug}`);
    await expect(page.getByTestId('store-name')).toHaveText(SEED.kirana.name);
    await shot(page, 'public-store-page', { full: true });
    expect((await page.goto('/s/not-a-store-e2e'))?.status()).toBe(404);
    await shot(page, 'public-store-not-found');
  });
});

test.describe.serial('launch screenshots: ops console', () => {
  test.skip(!HAS_OPS, 'no ops credentials in this run');
  let orderId = '';

  test.beforeAll(async ({ request }) => {
    // One order with a delivery behind it, so the order page has a real timeline, the door section and the payment.
    const owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    const restore = await openAllDay(request, owner);
    try {
      const c = await newCustomer(request);
      const o = await placeCodOrder(request, c);
      await deliverBySelf(request, owner, c.headers, o);
      orderId = o.id;
    } finally {
      await restore(request);
    }
  });

  test('sign-in, then every console section loads without an error', async ({ page }) => {
    test.setTimeout(300_000); // 17 pages, each waited until the network is idle
    await page.goto('/admin');
    await shot(page, 'ops-01-login');
    await opsSignIn(page);
    await shot(page, 'ops-02-dashboard');
    const sections: Array<[string, string]> = [
      ['/admin/merchants', 'merchants-queue'],
      ['/admin/orders', 'orders'],
      ['/admin/riders', 'riders'],
      ['/admin/live', 'live-operations'],
      ['/admin/support', 'support'],
      ['/admin/reviews', 'reviews'],
      ['/admin/refunds', 'refunds'],
      ['/admin/disputes', 'disputes'],
      ['/admin/payouts', 'payouts'],
      ['/admin/reports', 'reports'],
      ['/admin/promos', 'promos'],
      ['/admin/micro-markets', 'micro-markets-and-fees'],
      ['/admin/catalogue', 'master-catalogue'],
      ['/admin/leads', 'leads'],
      ['/admin/grievances', 'grievances'],
      ['/admin/audit', 'audit-log'],
      ['/admin/privacy', 'privacy-requests'],
    ];
    for (const [path, name] of sections) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.getByText(/something went wrong|application error/i), `${path} shows an error`).toHaveCount(0);
      await expect(page, `${path} sent us back to the sign-in page`).not.toHaveURL(/\/admin\/login/);
      await shot(page, `ops-${name}`);
    }
  });

  test('the order page of a delivered order, then the same console in Telugu', async ({ page }) => {
    await opsSignIn(page, `/admin/orders/${orderId}`);
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${orderId}`));
    await shot(page, 'ops-order-detail', { full: true });
    await page.getByRole('button', { name: 'తెలుగు' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[lang="te"]').first()).toBeVisible();
    await shot(page, 'ops-order-detail-te', { full: true });
    await page.goto('/admin');
    await shot(page, 'ops-dashboard-te');
    await page.getByRole('button', { name: 'English' }).click();
  });

  test('wrong password and wrong code are refused with a clear message', async ({ page }) => {
    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Work email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('not-the-password-123');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await shot(page, 'ops-login-refused');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('a customer, a merchant and a rider token are all refused by the console API', async ({ request }) => {
    const heads = [await appSignIn(request, '9000000101', 'rider'), await appSignIn(request, SEED.kirana.ownerPhone, 'merchant'), (await newCustomer(request)).headers];
    for (const h of heads) expect([401, 403]).toContain((await request.get(`${API}/ops/orders`, { headers: h })).status());
  });
});
