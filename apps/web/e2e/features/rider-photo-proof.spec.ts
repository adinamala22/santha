import { expect, test } from '@playwright/test';
import { API, appSignIn, call, HAS_OPS, LIVE, newCustomer, openAllDay, opsSignIn, SEED, uploadRiderPhoto, type Headers } from '../support/target';

/**
 * Door-photo proof (ADR-030), fake only: a prepaid order needs the payment to succeed, which only the fake backend can
 * do from a test (live test uses the Razorpay sandbox checkout). The rider arrives, a made-up photo id is refused, the
 * real door photo delivers the order, and the customer gets a private link to the photo.
 */
test.describe.serial('feature: door-photo proof of delivery', () => {
  test.skip(LIVE, 'prepaid orders need the fake payment endpoint');
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

  test('prepaid order left at the door with a photo; the customer and ops see it', async ({ request, page }) => {
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    const store = me.merchant.location as { lat: number; lng: number };
    await call(request, 'put', '/riders/me/status', { headers: rider, data: { online: true, zones: [me.merchant.microMarketId ?? me.microMarket.id] } });
    await call(request, 'post', '/riders/me/location', { headers: rider, data: north(store, 300), status: 204 });

    const customer = await newCustomer(request);
    const items = (await call(request, 'get', `/stores/${SEED.kirana.id}?lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`)).items;
    const atta = items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    await call(request, 'put', '/cart', { headers: customer.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 2 }] } });
    const q = await call(request, 'post', '/cart/price', { headers: customer.headers, data: { addressId: customer.addressId, when: { mode: 'asap' } }, status: 200 });
    const order = await call(request, 'post', '/orders', { headers: { ...customer.headers, 'Idempotency-Key': `e2e-photo-${Date.now()}` }, data: { quoteId: q.quoteId, paymentMethod: 'online' } });
    await call(request, 'post', `/dev/payments/${order.payment.intentId}/succeed`, { status: 200 });
    await call(request, 'post', `/orders/${order.id}/accept`, { headers: owner, data: { fulfilmentMode: 'rider' }, status: 200 });

    let offer: { id: string } | null = null;
    await expect.poll(async () => (offer = (await call(request, 'get', '/riders/me', { headers: rider })).offer), { timeout: 30_000 }).not.toBeNull();
    const job = await call(request, 'post', `/offers/${offer!.id}/accept`, { headers: rider, status: 200 });
    await call(request, 'post', `/orders/${order.id}/ready`, { headers: owner, status: 200 });
    const d = (await call(request, 'get', '/merchants/me/deliveries', { headers: owner })).items.find((x: { orderId: string }) => x.orderId === order.id);
    await call(request, 'post', `/jobs/${job.id}/picked-up`, { headers: rider, data: { pickupCode: d.pickupCode }, status: 200 });
    const atDoor = await call(request, 'post', `/jobs/${job.id}/arrived-drop`, { headers: rider, status: 200 });
    expect(atDoor.photoProofAllowed).toBe(true);

    const madeUp = await call(request, 'post', `/jobs/${job.id}/delivered`, { headers: rider, data: { photoMediaId: '6f1c2d3e-4a5b-4c6d-8e7f-001122334455' }, status: 400 });
    expect(madeUp.error.details.field).toBe('photoMediaId');
    const photoId = await uploadRiderPhoto(request, rider, 'delivery', job.id);
    await call(request, 'post', `/jobs/${job.id}/delivered`, { headers: rider, data: { photoMediaId: photoId }, status: 200 });

    const t = await call(request, 'get', `/orders/${order.id}/tracking`, { headers: customer.headers });
    expect(t.state).toBe('delivered');
    const img = await request.get(`${new URL(API).origin}${t.proofPhotoUrl}`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toBe('image/webp');

    // Ops see the same evidence on the order page (ADR-033): how it was confirmed, and the photo itself.
    test.skip(!HAS_OPS, 'needs ops credentials');
    await opsSignIn(page, `/admin/orders/${order.id}`);
    await expect(page.getByTestId('door-evidence')).toBeVisible();
    await expect(page.getByTestId('door-proof')).toContainText('door photo');
    const shot = page.getByTestId('door-photo');
    await expect(shot).toBeVisible();
    await expect.poll(() => shot.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  });
});
