import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

test.setTimeout(180_000);

/** M7 console: four-eyes refunds, settlement with CSV / PDF downloads, store disputes. */
const API = 'http://localhost:4000/v1';
const KIRANA = '10000000-0000-4000-8000-000000000201';
type Headers = Record<string, string>;

async function appSignIn(request: APIRequestContext, phone: string, app: 'consumer' | 'merchant'): Promise<Headers> {
  const deviceId = `e2e7-${app}-${phone}`;
  const c = await (await request.post(`${API}/auth/otp/request`, { data: { phone, app, deviceId } })).json();
  const s = await (await request.post(`${API}/auth/otp/verify`, { data: { challengeId: c.challengeId, code: '123456', deviceId, app, platform: 'android' } })).json();
  return { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId };
}

async function signIn(page: Page, email = 'admin@santha.local') {
  await page.context().clearCookies();
  await page.goto('/admin/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('santha-admin-dev');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: email.startsWith('finance') ? 'Settlements and payouts' : 'Overview' })).toBeVisible();
}

/** A delivered online order with a large "damaged" claim → a manual refund above ₹1,000. */
async function bigClaim(request: APIRequestContext) {
  const owner = await appSignIn(request, '9000000201', 'merchant');
  const day = [{ open: '00:00', close: '23:59' }];
  const me = await (await request.patch(`${API}/merchants/me`, { headers: owner, data: { hours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } } })).json();
  await request.put(`${API}/merchants/me/availability`, { headers: owner, data: { open: true } });
  const u = await appSignIn(request, '9000000001', 'consumer');
  const addressId = (await (await request.get(`${API}/me/addresses`, { headers: u })).json()).items[0].id;
  const store = await (await request.get(`${API}/stores/${KIRANA}?lat=14.45&lng=79.99`)).json();
  const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
  await request.put(`${API}/cart`, { headers: u, data: { merchantId: KIRANA, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 25 }] } });
  const q = await (await request.post(`${API}/cart/price`, { headers: u, data: { addressId, when: { mode: 'asap' } } })).json();
  const res = await request.post(`${API}/orders`, { headers: { ...u, 'Idempotency-Key': `e2e7-${Date.now()}` }, data: { quoteId: q.quoteId, paymentMethod: 'online' } });
  expect(res.status(), await res.text()).toBe(201);
  const o = await res.json();
  await request.post(`${API}/dev/payments/${o.payment.intentId}/succeed`);
  await request.post(`${API}/orders/${o.id}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId: me.staff[0].id } });
  await request.post(`${API}/orders/${o.id}/ready`, { headers: owner });
  const d = ((await (await request.get(`${API}/merchants/me/deliveries`, { headers: owner })).json()).items as Array<{ orderId: string; staffLink: string }>).find((x) => x.orderId === o.id)!;
  const token = d.staffLink.split('/d/')[1];
  await request.post(`${API}/staff-jobs/${token}/picked-up`);
  const otp = (await (await request.get(`${API}/orders/${o.id}/tracking`, { headers: u })).json()).deliveryOtp;
  expect((await request.post(`${API}/staff-jobs/${token}/delivered`, { data: { otp } })).status()).toBe(200);
  const order = await (await request.get(`${API}/orders/${o.id}`, { headers: u })).json();
  const issue = await (await request.post(`${API}/orders/${o.id}/issues`, { headers: u, data: { type: 'damaged', variantIds: [order.lines[0].variantId], description: 'Bags torn, flour everywhere' } })).json();
  expect(issue.status).toBe('pending_review');
  return { owner, order: order as { id: string; code: string }, amount: issue.refundPaise as number };
}

test('refunds: four-eyes — the second approval must come from someone else', async ({ page, request }) => {
  const { order } = await bigClaim(request);
  await signIn(page);
  await page.getByRole('link', { name: 'Refunds' }).click();
  await expect(page.getByRole('heading', { name: 'Refunds', level: 1 })).toBeVisible();
  const row = page.locator(`[data-testid^="refund-${order.code}-"]`);
  await row.getByRole('button', { name: 'Approve' }).click();
  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(row.getByText('Approved.')).toBeVisible();
  await page.reload();
  await expect(row).toContainText('Needs a second approval');
  await row.getByRole('button', { name: 'Approve' }).click();
  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(row.getByText('A second person must approve this refund.')).toBeVisible();

  await signIn(page, 'finance@santha.local');
  await page.goto('/admin/refunds');
  await row.getByRole('button', { name: 'Approve' }).click();
  await row.getByRole('button', { name: 'Confirm' }).click();
  // Refunded: it leaves the waiting list.
  await expect(row).toHaveCount(0);
  await page.goto('/admin/refunds?status=processed');
  await expect(row).toContainText('Refunded');
});

test('payouts: run tonight’s store settlement, download the CSV and a PDF statement', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Payouts' }).click();
  await expect(page.getByRole('heading', { name: 'Settlements and payouts', level: 1 })).toBeVisible();
  const form = page.getByRole('form', { name: 'Run' });
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(form.getByText('Settlement run finished.')).toBeVisible();
  await page.reload();
  const row = page.getByTestId('payout-Ramesh Stores');
  await expect(row).toBeVisible();
  const csv = await page.request.get(await page.getByRole('link', { name: 'Download CSV' }).getAttribute('href').then((h) => new URL(h!, page.url()).toString()));
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('Ramesh Stores');
  const pdfHref = await row.getByRole('link', { name: 'Statement (PDF)' }).getAttribute('href');
  const pdf = await page.request.get(new URL(pdfHref!, page.url()).toString());
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 8).toString()).toBe('%PDF-1.4');
});

test('disputes: a store disputes a refund charged to it; ops accepts it', async ({ page, request }) => {
  const owner = await appSignIn(request, '9000000201', 'merchant');
  const refunds = (await (await request.get(`${API}/merchants/me/refunds`, { headers: owner })).json()).items as Array<{ id: string; disputable: boolean }>;
  const r = refunds.find((x) => x.disputable);
  test.skip(!r, 'needs a processed store-liable refund from the refunds test');
  const d = await (await request.post(`${API}/merchants/me/disputes`, { headers: owner, data: { refundId: r!.id, reason: 'All bags were sealed at pickup; staff photo attached.' } })).json();
  await signIn(page);
  await page.getByRole('link', { name: 'Disputes' }).click();
  const row = page.getByTestId(`dispute-${d.id}`);
  await expect(row).toContainText('Ramesh Stores');
  await row.getByRole('button', { name: 'Accept' }).click();
  await row.getByLabel('Decision note').fill('Photo shows sealed bags');
  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(row).toHaveCount(0);
  await page.goto('/admin/disputes?status=accepted');
  await expect(row).toContainText('Accepted');
});
