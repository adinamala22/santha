import { expect, test } from '@playwright/test';
import { call, HAS_OPS, opsSignIn, SEED } from '../support/target';
import { stubMapTiles } from '../tiles';

/**
 * Service coverage (ADR-019), fake + live:
 * - /serviceability says why an address is not served and names the nearest area;
 * - store pages say why a store does not deliver (other area / too far);
 * - ops console: city-wide coverage switch, circle areas, store delivery radius.
 * Every setting a test changes is put back.
 */
test.setTimeout(150_000);
const q = (p: { lat: number; lng: number }) => `lat=${p.lat}&lng=${p.lng}`;
const far = { lat: 14.447, lng: 80.003 }; // Dargamitta, ~1.4 km from the kirana

test('serviceability explains "not deliverable" and names the nearest area', async ({ request }) => {
  const inside = await call(request, 'get', `/serviceability?${q(SEED.dargamitta)}`);
  expect(inside).toMatchObject({ serviceable: true, matchedBy: 'area', reason: null, nearest: null });
  const out = await call(request, 'get', `/serviceability?${q(SEED.outside)}`);
  if (out.serviceable) {
    // City-wide coverage is on (ops may have switched it on on test): served by the nearest area.
    expect(out).toMatchObject({ matchedBy: 'nearest', reason: null });
  } else {
    expect(out).toMatchObject({ reason: 'outside_service_area', microMarket: null });
    expect(out.nearest.name).toBe('Magunta Layout');
    expect(out.nearest.distanceM).toBeGreaterThan(3000);
  }
});

test('store page says why the store does not deliver to another area', async ({ request }) => {
  const page = await call(request, 'get', `/stores/${SEED.kirana.id}?${q(SEED.magunta)}`);
  expect(page).toMatchObject({ deliversHere: false, notDeliveringReason: 'other_area' });
  expect(page.deliveryRadiusM).toBeGreaterThanOrEqual(500);
  const home = await call(request, 'get', `/stores/${SEED.kirana.id}?${q(SEED.dargamitta)}`);
  expect(home).toMatchObject({ deliversHere: true, notDeliveringReason: null });
});

test.describe('ops console (ADR-019)', () => {
  test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');

  test('city-wide coverage: switch on → an address near an area is served; switched back', async ({ page, request }) => {
    await stubMapTiles(page);
    await opsSignIn(page, '/admin/micro-markets');
    const form = page.getByTestId('coverage-form');
    await expect(form).toBeVisible();
    const box = form.getByRole('checkbox', { name: 'Serve addresses near an area' });
    const km = form.getByRole('spinbutton', { name: 'Up to (km) from an area' });
    const wasOn = await box.isChecked();
    const wasKm = await km.inputValue();
    try {
      await box.check();
      await km.fill('5');
      await form.getByRole('button', { name: 'Save coverage' }).click();
      await expect(form.getByText('Coverage saved')).toBeVisible();
      await expect(form.getByText('On · up to 5 km')).toBeVisible();
      const out = await call(request, 'get', `/serviceability?${q(SEED.outside)}`);
      expect(out).toMatchObject({ serviceable: true, matchedBy: 'nearest', microMarket: { slug: 'magunta-layout' } });
    } finally {
      await page.reload();
      const f = page.getByTestId('coverage-form');
      if (wasOn) await f.getByRole('checkbox').check();
      else await f.getByRole('checkbox').uncheck();
      await f.getByRole('spinbutton').fill(wasKm);
      await f.getByRole('button', { name: 'Save coverage' }).click();
      await expect(f.getByText('Coverage saved')).toBeVisible();
    }
    if (!wasOn) expect((await call(request, 'get', `/serviceability?${q(SEED.outside)}`)).serviceable).toBe(false);
  });

  test('circle area tool turns centre + radius into the area points (not published)', async ({ page }) => {
    await stubMapTiles(page);
    await opsSignIn(page, '/admin/micro-markets/new');
    const tool = page.getByTestId('circle-tool');
    await tool.getByRole('textbox', { name: 'Radius (km)' }).fill('40');
    await tool.getByRole('button', { name: 'Use circle' }).click();
    await expect(tool.getByRole('alert')).toContainText('between 0.5 and 25 km');
    await tool.getByRole('textbox', { name: 'Radius (km)' }).fill('2');
    await tool.getByRole('button', { name: 'Use circle' }).click();
    await expect(page.getByText('48 points')).toBeVisible();
  });

  test('store delivery radius: ops shrink it → customers beyond see "too far"; put back; audited', async ({ page, request }) => {
    await stubMapTiles(page);
    await opsSignIn(page, `/admin/merchants/${SEED.kirana.id}`);
    const form = page.getByTestId('radius-form');
    const km = form.getByRole('spinbutton', { name: 'Delivers up to (km)' });
    const original = await km.inputValue();
    try {
      await km.fill('1');
      await form.getByRole('textbox', { name: /Why the change/ }).fill('E2E: radius check');
      await form.getByRole('button', { name: 'Save radius' }).click();
      await expect(form.getByText('Radius saved')).toBeVisible();
      const p = await call(request, 'get', `/stores/${SEED.kirana.id}?${q(far)}`);
      expect(p).toMatchObject({ deliversHere: false, notDeliveringReason: 'too_far', deliveryRadiusM: 1000 });
      await expect(page.getByText('Delivery radius changed').first()).toBeVisible();
    } finally {
      await page.reload();
      const f = page.getByTestId('radius-form');
      await f.getByRole('spinbutton').fill(original);
      await f.getByRole('textbox').fill('E2E: put back');
      await f.getByRole('button', { name: 'Save radius' }).click();
      await expect(f.getByText('Radius saved')).toBeVisible();
    }
    expect((await call(request, 'get', `/stores/${SEED.kirana.id}?${q(far)}`)).notDeliveringReason).toBeNull();
  });
});
