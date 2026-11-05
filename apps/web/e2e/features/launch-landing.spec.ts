import { expect, test } from '@playwright/test';
import { call, HAS_OPS, LIVE, opsSignIn } from '../support/target';

/**
 * Launch landing (ADR-023), fake + live:
 * - the site follows GET /v1/config/site: before launch "Launching soon on Android and iPhone" with a launch-list
 *   sign-up and no download links; once ops turn on app_downloads, the store links;
 * - /stores previews the shop card as the owner types (live-safe: nothing is submitted on test);
 * - fake only: the launch-list sign-up becomes a "Launch list" lead in the ops console.
 */
test('landing: launching soon until downloads are switched on, then the store links', async ({ page, request }) => {
  const site = await call(request, 'get', '/config/site');
  await page.goto('/');
  if (!site.appDownloads) {
    await expect(page.getByTestId('launch-badge')).toHaveText(/Launching soon in Nellore/);
    await expect(page.getByRole('heading', { name: 'Coming soon on Android and iPhone' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get it on Android' })).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Launching soon' })).toBeVisible();
    await page.getByRole('banner').getByRole('link', { name: 'Launching soon' }).click();
    await expect(page.getByRole('form', { name: 'Tell me when it launches' })).toBeInViewport();
    await page.goto('/?lang=te');
    await expect(page.getByRole('heading', { name: 'త్వరలో Android మరియు iPhone లో' })).toBeVisible();
  } else {
    await expect(page.getByRole('link', { name: 'Get it on Android' })).toHaveAttribute('href', site.androidUrl ?? '#download');
    await expect(page.getByTestId('launch-badge')).toHaveCount(0);
  }
});

test('/stores: the shop card preview follows what the owner types', async ({ page, request }) => {
  const site = await call(request, 'get', '/config/site');
  await page.goto('/stores');
  if (!site.appDownloads) await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your customers are about to find you on Santha');
  await expect(page.getByTestId('preview-name')).toHaveText('Your shop');
  await page.getByLabel('Shop name').fill('E2E Preview Kirana');
  await page.getByText('Pharmacy', { exact: true }).click();
  await page.getByLabel('Area (e.g. Magunta Layout)').fill('Dargamitta');
  await expect(page.getByTestId('preview-name')).toHaveText('E2E Preview Kirana');
  await expect(page.getByTestId('preview-meta')).toHaveText('Pharmacy · Dargamitta');
});

test('launch-list sign-up reaches the ops console (fake only: creates a lead)', async ({ page }) => {
  test.skip(LIVE, 'would add a lead on test on every deploy');
  test.skip(!HAS_OPS, 'needs the ops login');
  await page.goto('/');
  const form = page.getByRole('form', { name: 'Tell me when it launches' });
  await form.getByPlaceholder('Your name').fill('E2E Launch Lakshmi');
  await form.getByPlaceholder('Mobile number').fill('9876503009');
  await form.getByRole('button', { name: 'Notify me' }).click();
  await expect(page.getByTestId('launch-thanks')).toHaveText(/You are on the list!/);
  await opsSignIn(page, '/admin/leads');
  const row = page.getByTestId('lead-E2E Launch Lakshmi');
  await expect(row).toContainText('Launch list');
  await expect(row).toContainText('+919876503009');
});
