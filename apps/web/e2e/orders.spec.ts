import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

test.setTimeout(120_000);

/** M5 console: live orders — a COD order placed and accepted through the API shows up with its timeline and comms. */
const API = `http://localhost:${process.env.E2E_API_PORT ?? 4000}/v1`;
const KIRANA = '10000000-0000-4000-8000-000000000201';
const DAR = { lat: 14.4535, lng: 79.996 };

async function appSignIn(request: APIRequestContext, phone: string, app: 'consumer' | 'merchant') {
  const deviceId = `e2e-${app}-${phone}`;
  const c = await (await request.post(`${API}/auth/otp/request`, { data: { phone, app, deviceId } })).json();
  const s = await (await request.post(`${API}/auth/otp/verify`, { data: { challengeId: c.challengeId, code: '123456', deviceId, app, platform: 'android' } })).json();
  return { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId };
}

async function placeAndAccept(request: APIRequestContext) {
  const owner = await appSignIn(request, '9000000201', 'merchant');
  const day = [{ open: '00:00', close: '23:59' }];
  await request.patch(`${API}/merchants/me`, { headers: owner, data: { hours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } } });
  await request.put(`${API}/merchants/me/availability`, { headers: owner, data: { open: true } });
  const u = await appSignIn(request, '9000000001', 'consumer');
  const addressId = (await (await request.get(`${API}/me/addresses`, { headers: u })).json()).items[0].id;
  const store = await (await request.get(`${API}/stores/${KIRANA}?lat=${DAR.lat}&lng=${DAR.lng}`)).json();
  const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
  const rice = store.items.find((i: { name: string }) => i.name === 'Annapoorna Basmati Rice');
  await request.put(`${API}/cart`, {
    headers: u,
    data: { merchantId: KIRANA, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 2 }, { itemId: rice.id, variantId: rice.variants[0].id, quantity: 1, substitution: 'remove' }] },
  });
  const q = await (await request.post(`${API}/cart/price`, { headers: u, data: { addressId, when: { mode: 'asap' } } })).json();
  const res = await request.post(`${API}/orders`, { headers: { ...u, 'Idempotency-Key': `e2e-${Date.now()}` }, data: { quoteId: q.quoteId, paymentMethod: 'cod' } });
  expect(res.status(), await res.text()).toBe(201);
  const order = await res.json();
  expect((await request.post(`${API}/orders/${order.id}/accept`, { headers: owner, data: {} })).status()).toBe(200);
  expect((await request.post(`${API}/orders/${order.id}/items/${rice.variants[0].id}/unavailable`, { headers: owner, data: { action: 'remove' } })).status()).toBe(200);
  return order as { id: string; code: string };
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

test('orders: an accepted order appears under Preparing; its timeline and messages are shown', async ({ page, request }) => {
  const order = await placeAndAccept(request);
  await signIn(page);
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  const row = page.getByTestId(`order-${order.code}`);
  await expect(row).toContainText('Preparing');
  await expect(row).toContainText('Cash on delivery');

  await page.getByRole('link', { name: 'Preparing' }).click();
  await expect(row).toBeVisible();
  await page.getByRole('link', { name: 'Closed' }).click();
  await expect(row).toHaveCount(0);

  await page.goto(`/admin/orders/${order.id}`);
  await expect(page.getByRole('heading', { name: `#${order.code}` })).toBeVisible();
  await expect(page.getByTestId('step-PLACED')).toContainText('Customer');
  await expect(page.getByTestId('step-ACCEPTED')).toContainText('Store');
  await expect(page.getByText(/removed · ₹/)).toBeVisible();
  await expect(page.getByTestId('comm-push-merchant.new_order').or(page.getByTestId('comm-sms-customer.order_placed')).first()).toBeVisible();
});

test('orders: the page reads in Telugu', async ({ page }) => {
  await signIn(page);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'తెలుగు' }).click();
  await page.getByRole('link', { name: 'ఆర్డర్లు', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ఆర్డర్లు', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'సిద్ధం చేస్తున్నారు' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
});
