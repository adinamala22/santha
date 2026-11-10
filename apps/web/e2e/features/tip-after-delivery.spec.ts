import { expect, test } from '@playwright/test';
import { API, appSignIn, call, LIVE, newCustomer, openAllDay, SEED, type Headers } from '../support/target';

/**
 * Tip after delivery (ADR-037), fake only: a prepaid order needs the fake payment endpoints. The customer tips the
 * rider who delivered, on its own payment; a second tip is refused; someone else cannot tip it.
 */
test.describe.serial('feature: tip after delivery', () => {
  test.skip(LIVE, 'payments need the fake payment endpoints');
  let owner: Headers;
  let rider: Headers;
  let restoreHours: (request: import('@playwright/test').APIRequestContext) => Promise<void>;
  const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_195, lng: p.lng });

  test.beforeAll(async ({ request }) => {
    owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    restoreHours = await openAllDay(request, owner);
    for (const p of ['9000000102', '9000000103']) await request.put(`${API}/riders/me/status`, { headers: await appSignIn(request, p, 'rider'), data: { online: false } });
    rider = await appSignIn(request, '9000000101', 'rider');
  });
  test.afterAll(async ({ request }) => {
    if (rider) await request.put(`${API}/riders/me/status`, { headers: rider, data: { online: false } });
    await restoreHours?.(request);
  });

  test('the customer tips the rider after delivery, once', async ({ request }) => {
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    const store = me.merchant.location as { lat: number; lng: number };
    await call(request, 'put', '/riders/me/status', { headers: rider, data: { online: true, zones: [me.merchant.microMarketId ?? me.microMarket.id] } });
    await call(request, 'post', '/riders/me/location', { headers: rider, data: north(store, 300), status: 204 });

    const customer = await newCustomer(request);
    const stranger = await newCustomer(request);
    const items = (await call(request, 'get', `/stores/${SEED.kirana.id}?lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`)).items;
    const atta = items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    await call(request, 'put', '/cart', { headers: customer.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 2 }] } });
    const q = await call(request, 'post', '/cart/price', { headers: customer.headers, data: { addressId: customer.addressId, when: { mode: 'asap' } }, status: 200 });
    const order = await call(request, 'post', '/orders', { headers: { ...customer.headers, 'Idempotency-Key': `e2e-tipl-${Date.now()}` }, data: { quoteId: q.quoteId, paymentMethod: 'online' } });
    await call(request, 'post', `/dev/payments/${order.payment.intentId}/succeed`, { status: 200 });

    // Not delivered yet: nothing to tip.
    expect(await call(request, 'get', `/orders/${order.id}/tip`, { headers: customer.headers })).toMatchObject({ canTip: false, reason: 'not_delivered' });

    await call(request, 'post', `/orders/${order.id}/accept`, { headers: owner, data: { fulfilmentMode: 'rider' }, status: 200 });
    let offer: { id: string } | null = null;
    await expect.poll(async () => (offer = (await call(request, 'get', '/riders/me', { headers: rider })).offer), { timeout: 30_000 }).not.toBeNull();
    const job = await call(request, 'post', `/offers/${offer!.id}/accept`, { headers: rider, status: 200 });
    await call(request, 'post', `/orders/${order.id}/ready`, { headers: owner, status: 200 });
    const d = (await call(request, 'get', '/merchants/me/deliveries', { headers: owner })).items.find((x: { orderId: string }) => x.orderId === order.id);
    await call(request, 'post', `/jobs/${job.id}/picked-up`, { headers: rider, data: { pickupCode: d.pickupCode }, status: 200 });
    const otp = (await call(request, 'get', `/orders/${order.id}/tracking`, { headers: customer.headers })).deliveryOtp;
    await call(request, 'post', `/jobs/${job.id}/delivered`, { headers: rider, data: { otp }, status: 200 });

    const offerNow = await call(request, 'get', `/orders/${order.id}/tip`, { headers: customer.headers });
    expect(offerNow).toMatchObject({ canTip: true, reason: 'ok', tippedPaise: 0, minPaise: 1000, maxPaise: 20_000 });

    // Someone else cannot see or start it; the amounts are bounded.
    await call(request, 'get', `/orders/${order.id}/tip`, { headers: stranger.headers, status: 404 });
    await call(request, 'post', `/orders/${order.id}/tip`, { headers: customer.headers, data: { amountPaise: 500 }, status: 400 });

    const pay = await call(request, 'post', `/orders/${order.id}/tip`, { headers: customer.headers, data: { amountPaise: 2000 }, status: 200 });
    expect(pay).toMatchObject({ provider: 'mock', amountPaise: 2000, status: 'created' });
    await call(request, 'post', `/dev/tips/${pay.intentId}/succeed`, { status: 200 });

    expect(await call(request, 'get', `/orders/${order.id}/tip`, { headers: customer.headers })).toMatchObject({ canTip: false, reason: 'already_tipped', tippedPaise: 2000 });
    const again = await call(request, 'post', `/orders/${order.id}/tip`, { headers: customer.headers, data: { amountPaise: 1000 }, status: 409 });
    expect(again.error.code).toBe('TIP_NOT_ALLOWED');
  });
});
