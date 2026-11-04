import { expect, test } from '@playwright/test';
import { API, call, SEED } from '../support/target';

/** Smoke (fake + live): the API is ready, the public site and console load, in English and Telugu, with security headers. */

test('API is ready (database + Redis)', async ({ request }) => {
  const r = await request.get(`${API}/health/ready`);
  expect(r.status(), await r.text()).toBe(200);
});

test('landing page in English and Telugu', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  expect(res!.headers()['x-content-type-options']).toBe('nosniff');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/?lang=te');
  await expect(page.locator('[lang="te"]').first()).toBeVisible();
});

test('for-stores, riders, home-kitchens and legal pages load', async ({ page }) => {
  for (const path of ['/stores', '/riders', '/home-kitchens', '/legal/privacy', '/legal/terms', '/legal/grievance']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
  }
});

test('store link page for the demo kirana; unknown slugs 404', async ({ page, request }) => {
  const list = (await call(request, 'get', '/public/stores')).items as Array<{ slug: string; name: string }>;
  const ramesh = list.find((s) => s.name === SEED.kirana.name);
  expect(ramesh, 'demo kirana is live').toBeTruthy();
  await page.goto(`/s/${ramesh!.slug}`);
  await expect(page.getByTestId('store-name')).toHaveText(SEED.kirana.name);
  await expect(page.getByTestId('store-rating')).toBeVisible();
  const res = await page.goto('/s/not-a-store-e2e');
  expect(res?.status()).toBe(404);
});

test('ops console sign-in page loads', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByLabel('Work email')).toBeVisible();
});
