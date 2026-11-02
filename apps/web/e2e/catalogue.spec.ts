import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';

test.setTimeout(120_000);

/**
 * M2 console flows against `pnpm dev:fake`: catalogue QA (held items, photo moderation, unknown
 * barcodes) and assisted catalogue entry. Merchant-side setup goes straight to the API as a seeded
 * merchant (OTP 123456), the way the merchant app would.
 */
const API = 'http://localhost:4000';

async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
}
async function clickUntil(button: Locator, then: Locator) {
  await expect(async () => {
    await button.click();
    await expect(then).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await settled(page);
  await page.getByLabel('Work email').fill('admin@santha.local');
  await page.getByLabel('Password').fill('santha-admin-dev');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

async function merchant(request: APIRequestContext, phone: string) {
  const deviceId = `e2e-${phone}-${Date.now()}`;
  const otp = await (await request.post(`${API}/v1/auth/otp/request`, { data: { phone, deviceId, app: 'merchant' } })).json();
  const s = await (await request.post(`${API}/v1/auth/otp/verify`, { data: { challengeId: otp.challengeId, code: '123456', deviceId, app: 'merchant', platform: 'android' } })).json();
  return { authorization: `Bearer ${s.accessToken}`, 'x-device-id': deviceId };
}

/** A small valid PNG (RGB gradient) built by hand, so the test needs no image library. */
function png(width = 320, height = 240): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set([(x * 255) / width, (y * 255) / height, 120], y * (width * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test.describe('catalogue QA', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('a restricted item is held; ops rejects it with a note (audited)', async ({ page, request }) => {
    const h = await merchant(request, '9000000202'); // Sri Lakshmi Supermarket
    const name = `Beedi Bundle ${Date.now() % 100000}`;
    const r = await request.post(`${API}/v1/merchants/me/items`, { headers: h, data: { name, categorySlug: 'other_retail', variants: [{ label: '1 pc', unit: 'pc', unitQty: 1, pricePaise: 3000 }] } });
    expect((await r.json()).status).toBe('in_review');

    await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Catalogue QA' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('tobacco');
    await settled(page);
    await clickUntil(row.getByRole('button', { name: 'Reject' }), row.getByText(`Reject "${name}"?`, { exact: false }));
    await row.getByLabel('Note to the merchant (optional)').fill('Tobacco is not sold on Santha');
    await row.getByRole('button', { name: 'Confirm' }).click();
    await expect(row).toHaveCount(0); // decided items leave the queue

    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('row', { name: /item/ }).filter({ hasText: 'Sent back' }).first()).toBeVisible();
  });

  test('photo moderation: a new store photo is approved', async ({ page, request }) => {
    const h = await merchant(request, '9000000207'); // Amma's Pickles
    const t = await (await request.post(`${API}/v1/merchants/me/media`, { headers: h, data: { purpose: 'store', contentType: 'image/png' } })).json();
    expect((await request.put(`${API}${t.upload.url}`, { headers: { 'content-type': 'image/png' }, data: png() })).ok()).toBe(true);
    const done = await (await request.post(`${API}/v1/merchants/me/media/${t.media.id}/complete`, { headers: h })).json();
    expect(done.status).toBe('pending_review');

    await page.goto('/admin/catalogue?tab=photos');
    const card = page.getByRole('listitem').filter({ hasText: "Store photo · Amma's Pickles" }).last();
    await expect(card.getByRole('img')).toBeVisible();
    await settled(page);
    await clickUntil(card.getByRole('button', { name: 'Approve' }), card.getByText('Approve?'));
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card).toHaveCount(0); // approved photos leave the queue
  });

  test('an unknown barcode is added to the master catalogue; the next scan finds it', async ({ page, request }) => {
    const h = await merchant(request, '9000000201'); // Ramesh Stores
    const body = `89099${String(Date.now()).slice(-7)}`;
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
    const code = body + ((10 - (sum % 10)) % 10);
    expect((await request.get(`${API}/v1/catalogue/barcodes/${code}`, { headers: h })).status()).toBe(404);

    await page.goto('/admin/catalogue?tab=barcodes');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await row.getByLabel('Product name').fill('Nellore Kara Podi');
    await row.getByLabel('Brand').fill('Local');
    await row.getByLabel('MRP (₹)').fill('45');
    await row.getByLabel('Pack size').fill('100 g');
    await row.getByLabel('Category').selectOption('masala');
    await settled(page);
    await row.getByRole('button', { name: 'Add product' }).click();
    await expect(row).toHaveCount(0); // resolved requests leave the queue

    const scan = await (await request.get(`${API}/v1/catalogue/barcodes/${code}`, { headers: h })).json();
    expect(scan.product).toMatchObject({ name: 'Nellore Kara Podi', mrpPaise: 4500, packLabel: '100 g' });
  });
});

test.describe('assisted catalogue entry', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('ops adds an item and a pasted list for Kavya Boutique; they wait for the merchant', async ({ page, request }) => {
    await page.goto('/admin/merchants?status=live');
    await page.getByRole('row', { name: /Kavya Boutique/ }).getByRole('link', { name: 'View' }).click();
    await expect(page.getByRole('heading', { name: 'Kavya Boutique' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Store photos' })).toBeVisible();
    await page.getByRole('link', { name: 'Catalogue', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Catalogue · Kavya Boutique' })).toBeVisible();
    await settled(page);

    const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Add an item' }) });
    await form.getByLabel('Item name').fill('Gadwal Silk Saree');
    await form.getByLabel('Category').selectOption({ label: 'Sarees' });
    await form.getByLabel('Size or pack').fill('Free size');
    await form.getByLabel('Selling price (₹)').fill('8500');
    await form.getByRole('button', { name: 'Add for approval' }).click();
    await expect(form.getByText(/Catalogue pending your approval/)).toBeVisible();

    const list = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Paste a list (CSV)' }) });
    await list.getByRole('textbox').fill('name,category,size,unit,qty,price,mrp\nCotton Dupatta,accessories,Free size,pc,1,450,\nSilk Blouse,women_wear,M,pc,1,abc,\n');
    await list.getByRole('button', { name: 'Check list' }).click();
    await expect(list.getByText('1 items ready · 1 rows need fixing')).toBeVisible();
    await expect(list.getByText('Line 3: price is not a valid amount')).toBeVisible();
    await list.getByRole('button', { name: 'Add 1 items for approval' }).click();
    await expect(list.getByText('1 items added for the merchant’s approval.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('row', { name: /Gadwal Silk Saree/ })).toContainText('Waiting for merchant');
    await expect(page.getByRole('row', { name: /Cotton Dupatta/ })).toContainText('Waiting for merchant');

    // The merchant approves them in the app (API here); they go live.
    const h = await merchant(request, '9000000205');
    const ok = await (await request.post(`${API}/v1/merchants/me/items/approve`, { headers: h, data: { ids: 'all' } })).json();
    expect(ok.approved).toBeGreaterThanOrEqual(2);
    await page.reload();
    await expect(page.getByRole('row', { name: /Gadwal Silk Saree/ })).toContainText('Live');
  });

  test('Telugu console shows the catalogue in Telugu', async ({ page }) => {
    await page.goto('/admin/catalogue');
    await settled(page);
    await page.getByRole('button', { name: 'తెలుగు' }).click();
    await expect(page.getByRole('heading', { name: 'క్యాటలాగ్ QA' })).toBeVisible();
    await expect(page.getByRole('link', { name: /ఆపిన ఐటమ్‌లు/ })).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'Catalogue QA' })).toBeVisible();
  });
});
