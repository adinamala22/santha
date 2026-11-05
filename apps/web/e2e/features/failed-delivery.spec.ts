import { type APIRequestContext, expect, test } from '@playwright/test';
import { appSignIn, call, HAS_OPS, type Headers, newCustomer, openAllDay, opsSignIn, placeCodOrder, SEED } from '../support/target';

/**
 * Couldn't deliver (ADR-026), fake + live:
 * - store staff on the /d/ link report the customer did not answer; the order shows FAILED_DELIVERY and the
 *   staff page waits for support;
 * - ops see it under "Needs attention" and send it out again from the console (audited); the staff page can
 *   deliver it;
 * - a second failed delivery is cancelled by ops without a refund (COD, nothing was paid).
 * Each test places its own COD order for a new customer; the kirana's hours are put back afterwards.
 */
test.setTimeout(150_000);

async function onTheWayBySelf(request: APIRequestContext, owner: Headers, orderId: string) {
  const me = await call(request, 'get', '/merchants/me', { headers: owner });
  await call(request, 'post', `/orders/${orderId}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId: me.staff[0].id }, status: 200 });
  await call(request, 'post', `/orders/${orderId}/ready`, { headers: owner, status: 200 });
  let link: string | null = null;
  await expect
    .poll(async () => {
      link = (await call(request, 'get', '/merchants/me/deliveries', { headers: owner })).items.find((x: { orderId: string }) => x.orderId === orderId)?.staffLink ?? null;
      return link;
    }, { timeout: 30_000, message: 'staff delivery link' })
    .not.toBeNull();
  const token = link!.split('/d/')[1]!;
  await call(request, 'post', `/staff-jobs/${token}/picked-up`, { status: 200 });
  return token;
}

test.describe.serial("feature: couldn't deliver (ADR-026)", () => {
  let owner: Headers;
  let restoreHours: (request: APIRequestContext) => Promise<void>;

  test.beforeAll(async ({ request }) => {
    owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    restoreHours = await openAllDay(request, owner);
  });
  test.afterAll(async ({ request }) => restoreHours?.(request));

  test('staff report no answer on the delivery page; ops send it out again; it is delivered', async ({ page, request }) => {
    const customer = await newCustomer(request);
    const order = await placeCodOrder(request, customer);
    const token = await onTheWayBySelf(request, owner, order.id);

    await page.goto(`/d/${token}`);
    await page.getByTestId('couldnt-deliver').click();
    await page.getByLabel('Customer not answering').check();
    await page.getByRole('button', { name: 'Report' }).click();
    await expect(page.getByTestId('failed')).toContainText('Delivery not completed');
    expect((await call(request, 'get', `/orders/${order.id}`, { headers: customer.headers })).state).toBe('FAILED_DELIVERY');

    test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');
    await opsSignIn(page, '/admin/live');
    await expect(page.getByTestId('attention')).toContainText(`#${order.code}`);
    await expect(page.getByTestId(`failed-actions-${order.code}`)).toBeVisible(); // also on the board
    // Decide on the order page (the board refreshes itself every 15 s).
    await page.goto(`/admin/orders/${order.id}`);
    const actions = page.getByTestId(`failed-actions-${order.code}`);
    await actions.getByRole('button', { name: 'Send out again' }).click();
    await actions.getByRole('button', { name: 'Confirm' }).click();
    // The page refreshes and the order leaves "failed", so its buttons go away.
    await expect.poll(async () => (await call(request, 'get', `/orders/${order.id}`, { headers: customer.headers })).state).toBe('OUT_FOR_DELIVERY');
    await expect(actions).toHaveCount(0);

    const otp = (await call(request, 'get', `/orders/${order.id}/tracking`, { headers: customer.headers })).deliveryOtp;
    await call(request, 'post', `/staff-jobs/${token}/delivered`, { data: { otp, codCollectedPaise: order.totalPaise }, status: 200 });
    expect((await call(request, 'get', `/orders/${order.id}`, { headers: customer.headers })).state).toBe('DELIVERED');
  });

  test('ops cancel a failed delivery without a refund; the reason is required', async ({ page, request }) => {
    test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');
    const customer = await newCustomer(request);
    const order = await placeCodOrder(request, customer);
    const token = await onTheWayBySelf(request, owner, order.id);
    await call(request, 'post', `/staff-jobs/${token}/failed`, { data: { reason: 'customer_refused' }, status: 200 });

    await opsSignIn(page, `/admin/orders/${order.id}`);
    const actions = page.getByTestId(`failed-actions-${order.code}`);
    await actions.getByRole('button', { name: 'Cancel, no refund' }).click();
    await actions.getByRole('button', { name: 'Confirm' }).click();
    await expect(actions).toContainText('Write why in a few words');
    await actions.getByLabel('Why (kept in the audit log)').fill('Refused at the door (e2e)');
    await actions.getByRole('button', { name: 'Confirm' }).click();
    await expect.poll(async () => (await call(request, 'get', `/orders/${order.id}`, { headers: customer.headers })).state).toBe('CANCELLED');
    expect((await call(request, 'get', `/orders/${order.id}`, { headers: customer.headers })).refundedPaise).toBe(0);
    await expect(page.getByText('Cancelled').first()).toBeVisible();
  });
});
