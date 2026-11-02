import { expect, type Locator, type Page, test } from '@playwright/test';

test.setTimeout(120_000);

/** M4 console: promo codes with budgets — list the seeded codes, create one, pause it. */
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

test('promos: seeded codes with budgets; create a code; pause it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Promos' }).click();
  await expect(page.getByRole('heading', { name: 'Promo codes', level: 1 })).toBeVisible();
  await settled(page);

  const nellore = page.getByTestId('promo-NELLORE50');
  await expect(nellore).toContainText('₹50 off');
  await expect(nellore).toContainText('first order only');
  await expect(page.getByTestId('promo-KITCHEN20')).toContainText('20% off, up to ₹60');
  await expect(page.getByTestId('promo-KITCHEN20')).toContainText('50% merchant-funded');

  const code = `E2E${Date.now().toString().slice(-6)}`;
  const form = page.getByRole('form', { name: 'New promo code' });
  await form.getByLabel('Code').fill(code);
  await form.getByLabel('Description (English)').fill('₹30 off for e2e');
  await form.getByLabel('Description (Telugu)').fill('ఇ2ఇ కోసం ₹30 తగ్గింపు');
  await form.getByLabel('Value').fill('30');
  await form.getByLabel('Total budget (₹)').fill('300');
  await clickUntil(form.getByRole('button', { name: 'Create promo' }), page.getByText('Promo created.'));

  await page.reload();
  await settled(page);
  const row = page.getByTestId(`promo-${code.toUpperCase()}`);
  await expect(row).toContainText('₹30 off');
  await expect(row).toContainText('₹0 of ₹300');
  await expect(row).toContainText('Active');

  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row.getByText(`Pause ${code.toUpperCase()}? Customers can no longer apply it.`)).toBeVisible();
  await clickUntil(row.getByRole('button', { name: 'Confirm' }), row.getByText('Paused.'));
  await page.reload();
  await settled(page);
  await expect(page.getByTestId(`promo-${code.toUpperCase()}`)).toContainText('Paused');
});
