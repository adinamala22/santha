import { type APIRequestContext, expect, test } from '@playwright/test';
import { appSignIn, call, HAS_OPS, type Headers, newCustomer, opsSignIn, SEED } from '../support/target';

/**
 * City-wide stores and the Open switch (ADR-021), fake + live:
 * - the home feed lists every live store of the city, all deliverable; beyond a store's radius the card
 *   is marked and the bill adds the extra delivery charge (ADR-022);
 * - checkout ignores area borders (a Dargamitta address, a Magunta Layout store);
 * - "Deliver anywhere" (ADR-022) is shown to customers when the partner turns it on;
 * - the partner's Open switch outside the hours opens the store until the next close; off closes it;
 * - ops edit a store's hours in the console (audited).
 * The kirana's hours and Open switch are put back afterwards.
 */
test.setTimeout(150_000);
const q = (p: { lat: number; lng: number }) => `lat=${p.lat}&lng=${p.lng}`;
const SRI_LAKSHMI = '10000000-0000-4000-8000-000000000202'; // Magunta Layout, the area next to Dargamitta
const VEDAYAPALEM = { lat: 14.415, lng: 79.965 }; // ~5 km from the kirana
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const closedAllWeek = Object.fromEntries(DAYS.map((d) => [d, []]));

type Card = { id: string; deliverable: boolean; beyondRadius: boolean; deliversAnywhere: boolean; open: boolean; closesAt: string | null };
const feed = async (request: APIRequestContext, at: { lat: number; lng: number }) => (await call(request, 'get', `/feed?${q(at)}&tab=stores`)).stores as Card[];

test.describe.serial('feature: city-wide stores, the Open switch and hours (ADR-021)', () => {
  let owner: Headers;
  let before: { hours: unknown; acceptingOrders: boolean; deliversAnywhere: boolean };

  test.beforeAll(async ({ request }) => {
    owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    const m = (await call(request, 'get', '/merchants/me', { headers: owner })).merchant;
    before = { hours: m.hours, acceptingOrders: m.acceptingOrders, deliversAnywhere: !!m.deliversAnywhere };
  });
  test.afterAll(async ({ request }) => {
    if (!before) return;
    await call(request, 'patch', '/merchants/me', { headers: owner, data: { hours: before.hours, deliversAnywhere: before.deliversAnywhere } }); // also ends any open-until
    const now = (await call(request, 'get', '/merchants/me', { headers: owner })).merchant;
    if (now.acceptingOrders !== before.acceptingOrders) await call(request, 'put', '/merchants/me/availability', { headers: owner, data: { open: before.acceptingOrders } });
  });

  test('every store of the city is listed and delivers; beyond its radius it is marked for the extra charge (ADR-022)', async ({ request }) => {
    const far = await feed(request, VEDAYAPALEM);
    expect(far.every((s) => s.deliverable)).toBe(true);
    const page = await call(request, 'get', `/stores/${SEED.kirana.id}?${q(VEDAYAPALEM)}`);
    const beyond = page.store.distanceM > page.deliveryRadiusM;
    expect(far.find((s) => s.id === SEED.kirana.id), 'the kirana is listed in Vedayapalem').toMatchObject({ deliverable: true, beyondRadius: beyond });
    const near = await feed(request, SEED.dargamitta);
    expect(near.map((s) => s.id)).toEqual(expect.arrayContaining([SEED.kirana.id, SRI_LAKSHMI])); // a store from the next area too
  });

  test('checkout: any address of the city can order; beyond the radius the bill has the extra charge', async ({ request }) => {
    const page = await call(request, 'get', `/stores/${SRI_LAKSHMI}?${q(SEED.dargamitta)}`);
    expect(page.notDeliveringReason).not.toBe('other_area');
    const item = page.items.find((i: { stock: string }) => i.stock !== 'out');
    const customer = await newCustomer(request); // Dargamitta
    await call(request, 'put', '/cart', { headers: customer.headers, data: { merchantId: SRI_LAKSHMI, replace: true, lines: [{ itemId: item.id, variantId: item.variants[0].id, quantity: 1 }] } });
    const quote = await call(request, 'post', '/cart/price', { headers: customer.headers, data: { addressId: customer.addressId, when: { mode: 'asap' } }, status: 200 });
    const codes = (quote.problems as Array<{ code: string }>).map((p) => p.code);
    expect(codes).not.toContain('NOT_DELIVERABLE');
    const extra = (quote.bill.fees as Array<{ code: string; amountPaise: number }>).find((f) => f.code === 'beyond_radius');
    if (page.beyondRadiusSurchargePaise != null) expect(extra?.amountPaise).toBe(page.beyondRadiusSurchargePaise);
    else expect(extra).toBeUndefined();
    await call(request, 'put', '/cart', { headers: customer.headers, data: { merchantId: SRI_LAKSHMI, replace: true, lines: [] } });
  });

  test('"Deliver anywhere": the partner turns it on, customers see it; turned off again', async ({ request }) => {
    const on = await call(request, 'patch', '/merchants/me', { headers: owner, data: { deliversAnywhere: true } });
    expect(on.merchant.deliversAnywhere).toBe(true);
    const kirana = async () => (await feed(request, SEED.dargamitta)).find((s) => s.id === SEED.kirana.id)!;
    await expect.poll(async () => (await kirana()).deliversAnywhere, { timeout: 30_000, message: 'feed: delivers anywhere' }).toBe(true);
    await call(request, 'patch', '/merchants/me', { headers: owner, data: { deliversAnywhere: false } });
    await expect.poll(async () => (await kirana()).deliversAnywhere, { timeout: 30_000, message: 'feed: back to normal' }).toBe(false);
  });

  test('the Open switch outside the hours opens the store until the next close; off closes it', async ({ request }) => {
    const kirana = async () => (await feed(request, SEED.dargamitta)).find((s) => s.id === SEED.kirana.id)!;
    const shut = await call(request, 'patch', '/merchants/me', { headers: owner, data: { hours: closedAllWeek } });
    expect(shut.openNow.open).toBe(false);
    await expect.poll(async () => (await kirana()).open, { timeout: 30_000, message: 'feed: closed by the hours' }).toBe(false);

    const opened = await call(request, 'put', '/merchants/me/availability', { headers: owner, data: { open: true } });
    expect(opened.merchant.openUntil).toBeTruthy();
    expect(opened.openNow).toMatchObject({ open: true, closesAt: opened.merchant.openUntil });
    await expect.poll(async () => (await kirana()).open, { timeout: 30_000, message: 'feed: opened by the switch' }).toBe(true);
    expect((await kirana()).closesAt).toBe(opened.merchant.openUntil);

    const off = await call(request, 'put', '/merchants/me/availability', { headers: owner, data: { open: false } });
    expect(off.merchant).toMatchObject({ acceptingOrders: false, openUntil: null });
    await expect.poll(async () => (await kirana()).open, { timeout: 30_000, message: 'feed: paused' }).toBe(false);
  });

  test('late hours run past midnight: a closing time before the opening time ends the next day', async ({ request }) => {
    // Closed only for the hour starting an hour from now, open the rest of the day; whatever the time of day,
    // one of the two times is before the other, so this also covers the period running past midnight.
    const ist = new Date(Date.now() + 330 * 60_000);
    const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const hhmm = (x: number) => {
      const v = ((x % 1440) + 1440) % 1440;
      return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
    };
    const hours = Object.fromEntries(DAYS.map((d) => [d, [{ open: hhmm(nowMin + 120), close: hhmm(nowMin + 60) }]]));
    const saved = await call(request, 'patch', '/merchants/me', { headers: owner, data: { hours } });
    expect(saved.merchant.hours.mon).toEqual(hours.mon);
    const on = await call(request, 'put', '/merchants/me/availability', { headers: owner, data: { open: true } }); // the previous test paused it
    expect(on.openNow.open).toBe(true);
    expect(Math.abs(new Date(on.openNow.closesAt).getTime() - (Date.now() + 60 * 60_000))).toBeLessThan(2 * 60_000);
    await call(request, 'patch', '/merchants/me', { headers: owner, data: { hours: Object.fromEntries(DAYS.map((d) => [d, [{ open: '09:00', close: '09:00' }]])) }, status: 400 });
  });

  test('ops edit the hours in the console (audited)', async ({ page, request }) => {
    test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');
    await opsSignIn(page, `/admin/merchants/${SEED.kirana.id}`);
    const form = page.getByTestId('hours-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Mon Closed').setChecked(false);
    await form.getByLabel('Mon Opens').fill('08:00');
    await form.getByLabel('Mon Closes').fill('22:00');
    await form.getByLabel('Sun Closed').setChecked(true);
    await form.getByLabel('Why the change? (kept in the audit log)').fill('E2E hours check');
    await form.getByRole('button', { name: 'Save hours' }).click();
    await expect(form.getByText('Hours saved')).toBeVisible();
    // The form shows what was stored (not the values from before the save).
    await expect(form.getByLabel('Sun Closed')).toBeChecked();
    await expect(form.getByLabel('Mon Opens')).toHaveValue('08:00');
    const m = (await call(request, 'get', '/merchants/me', { headers: owner })).merchant;
    expect(m.hours.mon).toEqual([{ open: '08:00', close: '22:00' }]);
    expect(m.hours.sun).toEqual([]);
    await expect(page.getByText('Opening hours changed').first()).toBeVisible();
  });
});
