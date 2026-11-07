import { expect, test } from '@playwright/test';
import { appSignIn, call, freshPhone, HAS_OPS, opsSignIn } from '../support/target';

/**
 * Rider onboarding (ADR-029, rider audit B2), fake + live: a new rider cannot go online; they fill the steps in the
 * app (API) and submit; ops send them back with a reason from the console, the rider fixes it, ops approve, the
 * rider goes online. The test rider is paused at the end so it never takes real orders on the test environment.
 */
test.setTimeout(120_000);

test('a new rider signs up; ops send back, then approve; the rider can go online; paused at the end', async ({ page, request }) => {
  test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');
  const rider = await appSignIn(request, freshPhone(), 'rider');
  const me = await call(request, 'get', '/riders/me', { headers: rider });
  expect(me.status).toBe('draft');
  const refused = await call(request, 'put', '/riders/me/status', { headers: rider, data: { online: true, zones: [] }, status: 403 });
  expect(refused.error.code).toBe('RIDER_NOT_APPROVED');

  const name = `E2E Rider ${Date.now() % 100000}`;
  await call(request, 'put', '/riders/me/profile', { headers: rider, data: { name, vehicle: 'bike', vehicleNumber: 'AP 26 AB 4321' } });
  await call(request, 'put', '/riders/me/kyc/pan', { headers: rider, data: { pan: 'ABCPK1234K', name } });
  await call(request, 'put', '/riders/me/kyc/driving-licence', { headers: rider, data: { number: 'AP26 2019 0012345' } });
  await call(request, 'put', '/riders/me/kyc/bank', { headers: rider, data: { accountNumber: '123456789012', ifsc: 'SBIN0001234', holderName: name } });
  expect((await call(request, 'post', '/riders/me/submit', { headers: rider, status: 200 })).status).toBe('submitted');
  const userId = (await call(request, 'get', '/me', { headers: rider })).id as string;

  // The review queue lists them; the detail shows the steps and the licence to check.
  await opsSignIn(page, '/admin/riders?status=submitted');
  await expect(page.getByTestId(`rider-${userId}`)).toContainText(name);
  await page.getByTestId(`rider-${userId}`).getByRole('link', { name }).click();
  await expect(page.getByTestId('rider-steps')).toContainText('Driving licence');
  await expect(page.getByTestId('rider-check-driving_licence')).toContainText('AP2620190012345');
  await expect(page.getByText('Check the driving licence number against the card')).toBeVisible();

  // Sending back needs a reason the rider will see.
  await page.getByRole('button', { name: 'Send back' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Write why in a few words')).toBeVisible();
  await page.getByLabel(/Reason/).fill('The licence number does not match the card.');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Note to the rider: The licence number does not match the card.')).toBeVisible();
  await expect
    .poll(async () => (await call(request, 'get', '/riders/me', { headers: rider })).statusNote)
    .toBe('The licence number does not match the card.');

  // The rider fixes it and submits again; ops approve.
  await call(request, 'put', '/riders/me/kyc/driving-licence', { headers: rider, data: { number: 'AP26 2019 0054321' } });
  await call(request, 'post', '/riders/me/submit', { headers: rider, status: 200 });
  await page.reload();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(async () => (await call(request, 'get', '/riders/me', { headers: rider })).status).toBe('approved');
  await call(request, 'put', '/riders/me/status', { headers: rider, data: { online: true, zones: [] } });
  await call(request, 'put', '/riders/me/status', { headers: rider, data: { online: false } });

  // Pause the test rider so it never takes orders.
  await page.reload();
  await page.getByRole('button', { name: 'Pause rider' }).click();
  await page.getByLabel(/Reason/).fill('End of the automated test.');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(async () => (await call(request, 'get', '/riders/me', { headers: rider })).status).toBe('suspended');
});
