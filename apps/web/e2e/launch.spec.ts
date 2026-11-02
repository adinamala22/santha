import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

test.setTimeout(150_000);

/** M8: public site (landing, sign-up pages with lead forms, legal, store links) and the trust/compliance console. */
const API = 'http://localhost:4000/v1';
type Headers = Record<string, string>;

async function appSignIn(request: APIRequestContext, phone: string, app: 'consumer' | 'merchant'): Promise<Headers> {
  const deviceId = `e2e8-${app}-${phone}`;
  const c = await (await request.post(`${API}/auth/otp/request`, { data: { phone, app, deviceId } })).json();
  const s = await (await request.post(`${API}/auth/otp/verify`, { data: { challengeId: c.challengeId, code: '123456', deviceId, app, platform: 'android' } })).json();
  return { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId };
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/admin/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Work email').fill('admin@santha.local');
  await page.getByLabel('Password').fill('santha-admin-dev');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

test('landing → For stores → lead form; the lead reaches the ops console', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The whole town,');
  await page.getByRole('link', { name: 'Register your store' }).click();
  await expect(page.getByRole('heading', { name: 'Sell to your whole neighbourhood' })).toBeVisible();
  const form = page.getByRole('form', { name: 'Leave your details — our Nellore team will call you' });
  await form.getByRole('button', { name: 'Request a call' }).click();
  await expect(form.getByRole('alert')).toHaveText('Enter your name.');
  await form.getByLabel('Your name').fill('Venkata Kirana');
  await form.getByLabel('Mobile number').fill('98765 03001');
  await form.getByLabel('Area (e.g. Magunta Layout)').fill('Vedayapalem');
  await form.getByRole('button', { name: 'Request a call' }).click();
  await expect(page.getByTestId('lead-thanks')).toBeVisible();

  await signIn(page);
  await page.getByRole('link', { name: 'Leads' }).click();
  const row = page.getByTestId('lead-Venkata Kirana');
  await expect(row).toContainText('+919876503001');
  await row.getByRole('button', { name: 'Mark contacted' }).click();
  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(row.getByText('Updated.')).toBeVisible();
});

test('legal pages in English and Telugu; the riders page in Telugu', async ({ page }) => {
  await page.goto('/legal/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
  await expect(page.getByText(/DPDP Act 2023/).first()).toBeVisible();
  await page.getByRole('link', { name: 'తెలుగు' }).click();
  await expect(page.getByRole('heading', { name: 'గోప్యతా నోటీసు' })).toBeVisible();
  await page.goto('/legal/grievance');
  await expect(page.getByText(/within 48 hours/)).toBeVisible();
  await page.goto('/riders?lang=te');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('మీ ఊరిలో డెలివరీ చేయండి, రోజూ సంపాదించండి');
  const sitemap = await page.request.get('/sitemap.xml');
  expect(await sitemap.text()).toContain('/s/ramesh-stores-');
});

test('store link page: name, area, rating; unknown slugs 404', async ({ page, request }) => {
  const list = (await (await request.get(`${API}/public/stores`)).json()).items as Array<{ slug: string; name: string }>;
  const ramesh = list.find((s) => s.name === 'Ramesh Stores')!;
  await page.goto(`/s/${ramesh.slug}`);
  await expect(page.getByTestId('store-name')).toHaveText('Ramesh Stores');
  await expect(page.getByText(/Dargamitta, Nellore/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in the Santha app' })).toHaveAttribute('href', /^santha:\/\/store\//);
  const res = await page.goto('/s/not-a-store');
  expect(res?.status()).toBe(404);
});

test('console: grievance acknowledged and resolved; privacy erasure request; reports page', async ({ page, request }) => {
  const u = await appSignIn(request, '9000000002', 'consumer');
  await request.post(`${API}/me/grievances`, { headers: u, data: { category: 'account', description: 'I cannot change my phone number in the app.' } });
  await request.post(`${API}/me/data-requests`, { headers: u, data: { type: 'correction', details: 'Please fix my name to Ravi Kumar' } });

  await signIn(page);
  await page.getByRole('link', { name: 'Grievances' }).click();
  const g = page.locator('[data-testid^="grievance-"]').filter({ hasText: 'cannot change my phone' });
  await g.getByRole('button', { name: 'Acknowledge' }).click();
  await g.getByRole('button', { name: 'Confirm' }).click();
  await expect(g.getByText('Acknowledged.')).toBeVisible();
  await page.reload();
  await g.getByRole('button', { name: 'Resolve' }).click();
  await g.getByLabel('Resolution (shown to the person)').fill('Phone change is done by support; we updated it for you.');
  await g.getByRole('button', { name: 'Confirm' }).click();
  await expect(g).toHaveCount(0);

  await page.getByRole('link', { name: 'Privacy requests' }).click();
  const r = page.getByTestId('request-correction').filter({ hasText: 'Ravi Kumar' });
  await r.getByRole('button', { name: 'Complete' }).click();
  await r.getByLabel('Note (what was verified / done)').fill('Name corrected');
  await r.getByRole('button', { name: 'Confirm' }).click();
  await expect(r).toHaveCount(0); // done: it leaves the open list

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.getByTestId('funnel')).toContainText('Placed');
  await expect(page.getByTestId('contribution')).toContainText('Commission');
});
