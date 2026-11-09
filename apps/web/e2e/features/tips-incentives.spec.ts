import { expect, test } from '@playwright/test';
import { appSignIn, call, HAS_OPS, LIVE, opsSignIn } from '../support/target';

/**
 * Tips, incentives and the cash limit (ADR-032). The tip itself is covered by the rider journey (live-safe).
 * Here: the micro-market editor offers the cash limit and incentive rows (read only, fake + live), and ops record a
 * cash deposit for a rider from the console (fake only: it changes a demo rider's payout).
 */
test.setTimeout(120_000);

test('the micro-market editor has the cash limit and incentive rows', async ({ page }) => {
  test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');
  await opsSignIn(page, '/admin/micro-markets/new');
  await expect(page.getByLabel('Cash limit per rider (₹)')).toBeVisible();
  await expect(page.getByLabel('Cash limit per rider (₹)')).toHaveValue(''); // no limit by default
  await expect(page.getByTestId('incentives').getByLabel('Deliveries 1')).toBeVisible();
  await expect(page.getByTestId('incentives').getByLabel('Period 1')).toHaveValue('day');
});

test('ops record a cash deposit; the rider sees less cash in hand', async ({ page, request }) => {
  test.skip(LIVE, 'changes a demo rider payout');
  const rider = await appSignIn(request, '9000000102', 'rider'); // Demo Rider 2
  const me = await call(request, 'get', '/me', { headers: rider });
  const before = (await call(request, 'get', '/riders/me', { headers: rider })).cashInHandPaise as number;

  await opsSignIn(page, `/admin/riders/${me.id}`);
  const form = page.getByTestId('deposit-form');
  await form.getByLabel('Amount (₹)').fill('0');
  await form.getByRole('button', { name: 'Record deposit' }).click();
  await expect(form.getByLabel('Amount (₹)')).toHaveJSProperty('validity.valid', false); // min 1
  await form.getByLabel('Amount (₹)').fill('1');
  await form.getByLabel('Note (optional)').fill('E2E deposit');
  await form.getByRole('button', { name: 'Record deposit' }).click();
  await expect(page.getByText('Deposit recorded.')).toBeVisible();
  const after = (await call(request, 'get', '/riders/me', { headers: rider })).cashInHandPaise as number;
  expect(after).toBe(Math.max(0, before - 100));
});
