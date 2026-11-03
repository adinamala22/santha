import { expect, type Locator, type Page, test } from '@playwright/test';
import { stubMapTiles } from './tiles';

test.setTimeout(120_000); // first visit to each page compiles it in dev mode

/** Wait until the page is hydrated (dev compiles + client bundles loaded) before interacting. */
async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
}

/** Click, retrying until `then` holds — guards against clicks landing before hydration. */
async function clickUntil(button: Locator, then: Locator) {
  await expect(async () => {
    await button.click();
    await expect(then).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Our error/notice text (Next's route announcer also has role=alert). */
const alertText = (page: Page, text: string | RegExp) => page.getByRole('alert').filter({ hasText: text });

/**
 * M1 ops console flows in a real browser against `pnpm dev:fake` (seeded data, OTP 123456):
 * sign in, review → approve → go live, send back with a reason, publish a micro-market version,
 * Telugu console. The fake store resets when the backend restarts; tests use distinct merchants.
 */

async function signIn(page: Page, next = '/admin') {
  await page.goto(`/admin/login${next !== '/admin' ? `?next=${encodeURIComponent(next)}` : ''}`);
  await settled(page);
  await page.getByLabel('Work email').fill('admin@santha.local');
  await page.getByLabel('Password').fill('santha-admin-dev');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Code sent to \+9190\*+00/)).toBeVisible();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
}

test('signed-out users are sent to sign-in and come back afterwards', async ({ page }) => {
  await page.goto('/admin/merchants');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fmerchants/);
  await signIn(page, '/admin/merchants');
  await expect(page).toHaveURL(/\/admin\/merchants$/);
  await expect(page.getByRole('heading', { name: 'Merchants' })).toBeVisible();
});

test('wrong password shows one generic error', async ({ page }) => {
  await page.goto('/admin/login');
  await settled(page);
  await page.getByLabel('Work email').fill('admin@santha.local');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(alertText(page, 'Email or password is not right.')).toBeVisible();
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await stubMapTiles(page);
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });

  test('review queue → approve → go live (audited)', async ({ page }) => {
    await page.getByRole('link', { name: /Merchant review queue/ }).click();
    const row = page.getByRole('row', { name: /Sweet Crumbs Home Bakery/ });
    await row.getByRole('link', { name: 'View' }).click();
    await expect(page.getByRole('heading', { name: 'Sweet Crumbs Home Bakery' })).toBeVisible();
    await expect(page.getByText('FSSAI verified (food seller)')).toBeVisible();
    await settled(page);

    await clickUntil(page.getByRole('button', { name: 'Approve' }), page.getByText(/^Approve Sweet Crumbs Home Bakery\?/));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible();

    await clickUntil(page.getByRole('button', { name: 'Go live' }), page.getByText(/will be visible to customers in Magunta Layout/));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('No actions available in this state.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Went live' })).toBeVisible();

    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('cell', { name: 'Went live' }).first()).toBeVisible();
  });

  test('send back needs a reason and shows it on the merchant', async ({ page }) => {
    await page.goto('/admin/merchants?status=submitted');
    await page.getByRole('row', { name: /Nellore Footwear/ }).getByRole('link', { name: 'View' }).click();
    await expect(page.getByRole('heading', { name: 'Nellore Footwear' })).toBeVisible();
    await settled(page);
    await clickUntil(page.getByRole('button', { name: 'Send back' }), page.getByLabel('Reason'));
    await page.getByLabel('Reason').selectOption('documents_unclear');
    await page.getByLabel('Note (optional)').fill('Return policy must mention refunds');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(alertText(page, 'Sent back: Details unclear or incomplete — Return policy must mention refunds')).toBeVisible();
  });

  test('publish a micro-market version (fee change) and see it in history', async ({ page }) => {
    const cspViolations: string[] = [];
    page.on('console', (m) => m.text().includes('Content Security Policy') && cspViolations.push(m.text()));
    await page.getByRole('link', { name: 'Micro-markets' }).click();
    await page.getByRole('row', { name: /Dargamitta/ }).getByRole('link', { name: 'View' }).click();
    await expect(page.getByText(/Version 1 · since/).first()).toBeVisible();
    await settled(page);
    await page.getByLabel('Platform fee').fill('7');
    await page.getByLabel('Change note').fill('Platform fee to ₹7');
    await page.getByRole('button', { name: 'Publish a new version' }).click();
    await expect(page.getByText('Version 2 published.')).toBeVisible();
    await expect(page.getByText('Platform fee to ₹7')).toBeVisible();
    expect(cspViolations, 'the map (tiles, workers) must not be blocked by the CSP').toEqual([]);
  });

  test('the console works in Telugu', async ({ page }) => {
    await settled(page);
    await page.getByRole('button', { name: 'తెలుగు' }).click();
    await expect(page.getByRole('heading', { name: 'సారాంశం' })).toBeVisible();
    await page.getByRole('link', { name: 'వ్యాపారులు' }).click();
    await expect(page.getByRole('heading', { name: 'వ్యాపారులు' })).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'Merchants' })).toBeVisible();
  });
});
