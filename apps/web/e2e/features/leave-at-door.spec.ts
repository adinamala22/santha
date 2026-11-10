import { expect, test } from '@playwright/test';
import { appSignIn, call, freshPhone, HAS_OPS, type Headers, LIVE, openAllDay, opsSignIn, SEED } from '../support/target';

/**
 * Leave at the door (ADR-036), fake only (a prepaid order needs the fake payment endpoint): an address saved with the
 * choice makes the order carry it, the rider's job says so, cash orders never do, and ops see it on the order page.
 */
test.describe.serial('feature: leave at the door', () => {
  test.skip(LIVE, 'prepaid orders need the fake payment endpoint');
  let owner: Headers;
  let restoreHours: (request: import('@playwright/test').APIRequestContext) => Promise<void>;

  test.beforeAll(async ({ request }) => {
    owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    restoreHours = await openAllDay(request, owner);
  });
  test.afterAll(async ({ request }) => {
    await restoreHours?.(request);
  });

  test('the saved choice rides on a prepaid order, not on a cash one; ops see it', async ({ request, page }) => {
    const phone = freshPhone();
    const headers = await appSignIn(request, phone, 'consumer');
    const address = await call(request, 'post', '/me/addresses', {
      headers,
      data: { label: 'home', line: `E2E ${phone.slice(-4)}, Dargamitta Main Road`, location: SEED.dargamitta, leaveAtDoor: true },
    });
    expect(address.leaveAtDoor).toBe(true);

    const items = (await call(request, 'get', `/stores/${SEED.kirana.id}?lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`)).items;
    const atta = items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    const quote = async () => {
      await call(request, 'put', '/cart', { headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 2 }] } });
      return call(request, 'post', '/cart/price', { headers, data: { addressId: address.id, when: { mode: 'asap' } }, status: 200 });
    };
    const q1 = await quote();
    expect(q1.address.leaveAtDoor).toBe(true);
    const prepaid = await call(request, 'post', '/orders', { headers: { ...headers, 'Idempotency-Key': `e2e-lad-${Date.now()}-1` }, data: { quoteId: q1.quoteId, paymentMethod: 'online' } });
    expect(prepaid.address.leaveAtDoor).toBe(true);
    const q2 = await quote();
    const cash = await call(request, 'post', '/orders', { headers: { ...headers, 'Idempotency-Key': `e2e-lad-${Date.now()}-2` }, data: { quoteId: q2.quoteId, paymentMethod: 'cod', leaveAtDoor: true } });
    expect(cash.address.leaveAtDoor).toBe(false); // cash is collected at the door

    test.skip(!HAS_OPS, 'needs ops credentials');
    await opsSignIn(page, `/admin/orders/${prepaid.id}`);
    await expect(page.getByTestId('leave-at-door')).toContainText('Leave at the door: yes');
    await page.goto(`/admin/orders/${cash.id}`);
    await expect(page.getByTestId('leave-at-door')).toContainText('Leave at the door: no');
  });
});
