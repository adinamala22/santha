import { type APIRequestContext, expect, type Page } from '@playwright/test';

/**
 * Where the suite runs (docs/testing/e2e.md):
 * - `fake` (default; CI on every PR): `pnpm --filter web e2e`, both servers started by playwright.config.ts,
 *   in-memory backend with demo data. Every spec runs.
 * - `live` (after each deploy to test): `pnpm --filter web e2e:live`, against https://test.santhaapp.com.
 *   Specs tagged `@fake` (clock control, mock payments, one-off seeded states) are skipped; live specs put back
 *   whatever they change (store hours, radius, coverage).
 */
export const TARGET = process.env.E2E_TARGET === 'live' ? 'live' : 'fake';
export const LIVE = TARGET === 'live';
export const API = `${process.env.E2E_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? 4000}`}/v1`;

/** Ops login: the seeded admin in fake mode; the QA ops user (GitHub secrets) on test. */
export const OPS = {
  email: process.env.E2E_OPS_EMAIL ?? 'admin@santha.local',
  password: process.env.E2E_OPS_PASSWORD ?? 'santha-admin-dev',
};
export const HAS_OPS = !LIVE || !!process.env.E2E_OPS_PASSWORD;

/** Fixed OTP: fake mode and test (mock OTP provider); never production. */
export const OTP = '123456';

/** Demo data (apps/backend/src/dev/seed-data.ts), also seeded on test. */
export const SEED = {
  kirana: { id: '10000000-0000-4000-8000-000000000201', name: 'Ramesh Stores', ownerPhone: '9000000201' },
  dargamitta: { lat: 14.4525, lng: 79.995 },
  magunta: { lat: 14.4525, lng: 79.975 },
  outside: { lat: 14.48, lng: 79.94 },
};

export type Headers = Record<string, string>;
export type App = 'consumer' | 'merchant' | 'rider';

/** A phone number nobody else in this run uses (live runs leave data behind on test). */
export function freshPhone(): string {
  return `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

/** Sessions are reused within a run: test enforces the real OTP resend cooldown and hourly limits. */
const sessions = new Map<string, Headers>();

export async function appSignIn(request: APIRequestContext, phone: string, app: App): Promise<Headers> {
  const key = `${app}:${phone}`;
  const cached = sessions.get(key);
  if (cached && (await request.get(`${API}/me`, { headers: cached })).ok()) return cached;
  const deviceId = `e2e-${TARGET}-${app}-${phone}`;
  let r = await request.post(`${API}/auth/otp/request`, { data: { phone, app, deviceId } });
  if (r.status() === 429) {
    // Resend cooldown: wait it out once.
    const wait = Number((await r.json()).error?.details?.retryAfterSec ?? 30);
    await new Promise((res) => setTimeout(res, (wait + 1) * 1000));
    r = await request.post(`${API}/auth/otp/request`, { data: { phone, app, deviceId } });
  }
  expect(r.status(), await r.text()).toBe(200);
  const c = await r.json();
  const v = await request.post(`${API}/auth/otp/verify`, { data: { challengeId: c.challengeId, code: OTP, deviceId, app, platform: 'android' } });
  expect(v.status(), await v.text()).toBe(200);
  const s = await v.json();
  const headers = { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId };
  sessions.set(key, headers);
  return headers;
}

/** JSON call that must succeed with `status`; returns the body. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON bodies are checked by the assertions that use them
export async function call<T = any>(
  request: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  opts: { headers?: Headers; data?: unknown; status?: number } = {},
): Promise<T> {
  const r = await request[method](`${API}${path}`, { headers: opts.headers, data: opts.data });
  expect(r.status(), `${method.toUpperCase()} ${path}: ${await r.text()}`).toBe(opts.status ?? (method === 'post' ? 201 : 200));
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Ops console sign-in (email + password, then the phone code). */
export async function opsSignIn(page: Page, next = '/admin') {
  await page.goto(`/admin/login${next !== '/admin' ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Work email').fill(OPS.email);
  await page.getByLabel('Password').fill(OPS.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill(OTP);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).not.toHaveURL(/\/admin\/login/);
}

/** The store open around the clock for the test; returns a function that puts its hours back (pass the hook's own request). */
export async function openAllDay(request: APIRequestContext, owner: Headers): Promise<(request: APIRequestContext) => Promise<void>> {
  const before = await call(request, 'get', '/merchants/me', { headers: owner });
  const day = [{ open: '00:00', close: '23:59' }];
  const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  await call(request, 'patch', '/merchants/me', { headers: owner, data: { hours } });
  await call(request, 'put', '/merchants/me/availability', { headers: owner, data: { open: true } });
  return async (req: APIRequestContext) => {
    await call(req, 'patch', '/merchants/me', { headers: owner, data: { hours: before.merchant.hours } });
  };
}

/** A new customer with a saved address at `at` (Dargamitta by default). */
export async function newCustomer(request: APIRequestContext, at = SEED.dargamitta) {
  const phone = freshPhone();
  const headers = await appSignIn(request, phone, 'consumer');
  const a = await call(request, 'post', '/me/addresses', { headers, data: { label: 'home', line: `E2E ${phone.slice(-4)}, Dargamitta Main Road`, location: at } });
  return { phone, headers, addressId: a.id as string };
}

/** Places a COD order of atta at the kirana (works on test, where payments are Razorpay sandbox). */
export async function placeCodOrder(request: APIRequestContext, customer: { headers: Headers; addressId: string }) {
  const store = await call(request, 'get', `/stores/${SEED.kirana.id}?lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`);
  const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
  expect(atta, 'seeded item Annapoorna Chakki Atta').toBeTruthy();
  await call(request, 'put', '/cart', { headers: customer.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 2 }] } });
  const q = await call(request, 'post', '/cart/price', { headers: customer.headers, data: { addressId: customer.addressId, when: { mode: 'asap' } }, status: 200 });
  return call<{ id: string; code: string; state: string; totalPaise: number }>(request, 'post', '/orders', {
    headers: { ...customer.headers, 'Idempotency-Key': `e2e-${TARGET}-${Date.now()}-${Math.random()}` },
    data: { quoteId: q.quoteId, paymentMethod: 'cod' },
  });
}

/** The store accepts with self-delivery; its staff picks up and delivers with the customer's OTP, collecting cash. */
export async function deliverBySelf(request: APIRequestContext, owner: Headers, customer: Headers, order: { id: string; totalPaise: number }) {
  const me = await call(request, 'get', '/merchants/me', { headers: owner });
  await call(request, 'post', `/orders/${order.id}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId: me.staff[0].id }, status: 200 });
  await call(request, 'post', `/orders/${order.id}/ready`, { headers: owner, status: 200 });
  // On test the delivery is set up by a background job (BullMQ) after accept: wait for its staff link.
  let d: { staffLink: string | null } | undefined;
  await expect
    .poll(async () => {
      d = (await call(request, 'get', '/merchants/me/deliveries', { headers: owner })).items.find((x: { orderId: string }) => x.orderId === order.id);
      return d?.staffLink ?? null;
    }, { timeout: 30_000, message: 'staff delivery link' })
    .not.toBeNull();
  const token = d!.staffLink!.split('/d/')[1];
  await call(request, 'post', `/staff-jobs/${token}/picked-up`, { status: 200 });
  const otp = (await call(request, 'get', `/orders/${order.id}/tracking`, { headers: customer })).deliveryOtp;
  await call(request, 'post', `/staff-jobs/${token}/delivered`, { data: { otp, codCollectedPaise: order.totalPaise }, status: 200 });
}
