import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { stubMapTiles } from './tiles';

test.setTimeout(150_000);

/** M6 console: live board with dispatch overrides, and the public staff delivery link. */
const API = 'http://localhost:4000/v1';
const KIRANA = '10000000-0000-4000-8000-000000000201';

type Headers = Record<string, string>;
async function appSignIn(request: APIRequestContext, phone: string, app: 'consumer' | 'merchant' | 'rider'): Promise<Headers> {
  const deviceId = `e2e6-${app}-${phone}`;
  const c = await (await request.post(`${API}/auth/otp/request`, { data: { phone, app, deviceId } })).json();
  const s = await (await request.post(`${API}/auth/otp/verify`, { data: { challengeId: c.challengeId, code: '123456', deviceId, app, platform: 'android' } })).json();
  return { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId };
}
const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_195, lng: p.lng });

async function setup(request: APIRequestContext) {
  const owner = await appSignIn(request, '9000000201', 'merchant');
  const day = [{ open: '00:00', close: '23:59' }];
  const me = await (await request.patch(`${API}/merchants/me`, { headers: owner, data: { hours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } } })).json();
  await request.put(`${API}/merchants/me/availability`, { headers: owner, data: { open: true } });
  const consumer = await appSignIn(request, '9000000001', 'consumer');
  return { owner, consumer, store: me.merchant.location as { lat: number; lng: number }, zone: me.microMarket.id as string, staffId: me.staff[0].id as string };
}

async function place(request: APIRequestContext, consumer: Headers, method: 'cod' | 'online') {
  const addressId = (await (await request.get(`${API}/me/addresses`, { headers: consumer })).json()).items[0].id;
  const store = await (await request.get(`${API}/stores/${KIRANA}?lat=14.45&lng=79.99`)).json();
  const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
  await request.put(`${API}/cart`, { headers: consumer, data: { merchantId: KIRANA, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 3 }] } });
  const q = await (await request.post(`${API}/cart/price`, { headers: consumer, data: { addressId, when: { mode: 'asap' } } })).json();
  const res = await request.post(`${API}/orders`, { headers: { ...consumer, 'Idempotency-Key': `e2e6-${Date.now()}-${Math.random()}` }, data: { quoteId: q.quoteId, paymentMethod: method } });
  expect(res.status(), await res.text()).toBe(201);
  const o = (await res.json()) as { id: string; code: string; payment: { intentId: string } | null };
  if (method === 'online') expect((await request.post(`${API}/dev/payments/${o.payment!.intentId}/succeed`)).status()).toBe(200);
  return o;
}

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Work email').fill('admin@santha.local');
  await page.getByLabel('Password').fill('santha-admin-dev');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

test('live board: KPIs, the rider on the job, and ops reassigns it to another rider', async ({ page, request }) => {
  await stubMapTiles(page);
  const { owner, consumer, store, zone } = await setup(request);
  const r1 = await appSignIn(request, '9000000101', 'rider');
  const r2 = await appSignIn(request, '9000000102', 'rider');
  for (const [r, m] of [
    [r1, 200],
    [r2, 2500],
  ] as const) {
    await request.put(`${API}/riders/me/status`, { headers: r, data: { online: true, zones: [zone] } });
    await request.post(`${API}/riders/me/location`, { headers: r, data: north(store, m) });
  }
  const o = await place(request, consumer, 'online');
  expect((await request.post(`${API}/orders/${o.id}/accept`, { headers: owner, data: { fulfilmentMode: 'rider' } })).status()).toBe(200);
  const offer = (await (await request.get(`${API}/riders/me`, { headers: r1 })).json()).offer;
  expect((await request.post(`${API}/offers/${offer.id}/accept`, { headers: r1 })).status()).toBe(200);

  await signIn(page);
  await page.getByRole('link', { name: 'Live orders' }).click();
  await expect(page.getByRole('heading', { name: 'Live orders · Nellore', level: 1 })).toBeVisible();
  await expect(page.getByText('Riders online')).toBeVisible();
  const row = page.getByTestId(`live-${o.code}`);
  await expect(row).toContainText('Rider · Demo Rider 1');

  await row.getByLabel('Choose a rider').selectOption({ label: 'Demo Rider 2' });
  await row.getByRole('button', { name: 'Reassign' }).click();
  await expect(row.getByText(`Give #${o.code} to Demo Rider 2?`)).toBeVisible();
  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(row.getByText('Reassigned.')).toBeVisible();
  const jobs = (await (await request.get(`${API}/riders/me`, { headers: r2 })).json()).jobs as Array<{ orderId: string }>;
  expect(jobs.map((j) => j.orderId)).toContain(o.id);

  for (const r of [r1, r2]) await request.put(`${API}/riders/me/status`, { headers: r, data: { online: false } });
});

test('staff link: pickup when ready, OTP at the door, cash for COD', async ({ page, request }) => {
  const { owner, consumer, staffId } = await setup(request);
  const o = await place(request, consumer, 'cod');
  expect((await request.post(`${API}/orders/${o.id}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId } })).status()).toBe(200);
  const d = ((await (await request.get(`${API}/merchants/me/deliveries`, { headers: owner })).json()).items as Array<{ orderId: string; staffLink: string }>).find((x) => x.orderId === o.id)!;
  const token = d.staffLink.split('/d/')[1]!;

  await page.goto(`/d/${token}`);
  await expect(page.getByRole('heading', { name: `Delivery #${o.code}` })).toBeVisible();
  await expect(page.getByText('Pick up at Ramesh Stores')).toBeVisible();
  await expect(page.getByText('The order is still being packed.')).toBeVisible();
  await page.getByRole('button', { name: 'Picked up' }).click();
  await expect(page.locator('main [role="alert"]')).toHaveText('The store has not marked it ready yet.');

  await request.post(`${API}/orders/${o.id}/ready`, { headers: owner });
  await page.getByRole('button', { name: 'Picked up' }).click();
  await expect(page.getByText('Delivery OTP from the customer')).toBeVisible();
  await expect(page.getByText(/^Collect ₹/)).toBeVisible();

  const otp = (await (await request.get(`${API}/orders/${o.id}/tracking`, { headers: consumer })).json()).deliveryOtp as string;
  await page.getByLabel('Delivery OTP from the customer').fill(otp === '0000' ? '1111' : '0000');
  await page.getByRole('button', { name: 'Mark delivered' }).click();
  await expect(page.locator('main [role="alert"]')).toHaveText('That OTP is not right. Ask the customer again.');
  await page.getByLabel('Delivery OTP from the customer').fill(otp);
  await page.getByRole('button', { name: 'Mark delivered' }).click();
  await expect(page.getByTestId('done')).toHaveText('Delivered. Thank you!');
  expect((await (await request.get(`${API}/orders/${o.id}`, { headers: consumer })).json()).state).toBe('DELIVERED');

  await page.getByRole('button', { name: 'తెలుగు' }).click();
  await expect(page.getByTestId('done')).toHaveText('డెలివరీ అయింది. ధన్యవాదాలు!');
});

test('staff link: a bad token says so', async ({ page }) => {
  await page.goto('/d/not-a-real-token');
  await expect(page.getByText('This delivery link is not valid or has expired.')).toBeVisible();
});
