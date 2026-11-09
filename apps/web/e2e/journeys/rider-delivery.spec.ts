import { expect, test } from '@playwright/test';
import { API, appSignIn, call, type Headers, newCustomer, openAllDay, placeCodOrder, SEED } from '../support/target';

/**
 * Hybrid fulfilment with a Santha rider, as the rider and partner apps drive it (fake + live): rider online
 * near the store → the store hands the order to a rider → offer → accept → arrive → pickup code → OTP at the
 * door with cash → the customer rates the delivery → the rider's rating updates (ADR-018).
 * Other demo riders go offline so the offer comes to ours; ours goes offline again at the end.
 */
test.describe.serial('journey: delivered by a rider', () => {
  const riderPhone = '9000000101'; // Demo Rider 1
  const others = ['9000000102', '9000000103'];
  let owner: Headers;
  let rider: Headers;
  let restoreHours: (request: import('@playwright/test').APIRequestContext) => Promise<void>;

  const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_195, lng: p.lng });

  test.beforeAll(async ({ request }) => {
    owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    restoreHours = await openAllDay(request, owner);
    for (const p of others) await call(request, 'put', '/riders/me/status', { headers: await appSignIn(request, p, 'rider'), data: { online: false } });
    rider = await appSignIn(request, riderPhone, 'rider');
  });
  test.afterAll(async ({ request }) => {
    if (rider) await request.put(`${API}/riders/me/status`, { headers: rider, data: { online: false } });
    await restoreHours?.(request);
  });

  test('rider home: zones and own rating', async ({ request }) => {
    const home = await call(request, 'get', '/riders/me', { headers: rider });
    expect(home.allZones.length).toBeGreaterThan(0);
    expect(home).toHaveProperty('rating');
  });

  test('offer → accept → pickup code → OTP + cash → delivered; the customer rates the rider', async ({ request }) => {
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    const store = me.merchant.location as { lat: number; lng: number };
    const zone = (me.merchant.microMarketId ?? me.microMarket.id) as string;
    await call(request, 'put', '/riders/me/status', { headers: rider, data: { online: true, zones: [zone] } });
    await call(request, 'post', '/riders/me/location', { headers: rider, data: north(store, 300), status: 204 });

    const customer = await newCustomer(request);
    const order = await placeCodOrder(request, customer, 2_000); // with a ₹20 tip (ADR-032)
    await call(request, 'post', `/orders/${order.id}/accept`, { headers: owner, data: { fulfilmentMode: 'rider' }, status: 200 });

    // Dispatch runs from the order event (BullMQ on test): wait for the offer.
    let offer: { id: string; pickup: { name: string }; payPaise: number } | null = null;
    await expect
      .poll(async () => (offer = (await call(request, 'get', '/riders/me', { headers: rider })).offer), { timeout: 30_000, message: 'the offer reaches Demo Rider 1' })
      .not.toBeNull();
    expect(offer!.pickup.name).toBe(SEED.kirana.name);
    expect(offer!.payPaise).toBeGreaterThan(0);

    const job = await call(request, 'post', `/offers/${offer!.id}/accept`, { headers: rider, status: 200 });
    expect(job).toMatchObject({ code: order.code, state: 'assigned', pickupCodeRequired: true });
    await call(request, 'post', `/jobs/${job.id}/arrived`, { headers: rider, status: 200 });
    await call(request, 'post', `/orders/${order.id}/ready`, { headers: owner, status: 200 });
    const d = (await call(request, 'get', '/merchants/me/deliveries', { headers: owner })).items.find((x: { orderId: string }) => x.orderId === order.id);
    const wrong = await request.post(`${API}/jobs/${job.id}/picked-up`, { headers: rider, data: { pickupCode: d.pickupCode === '0000' ? '1111' : '0000' } });
    expect(wrong.status()).toBe(422);
    await call(request, 'post', `/jobs/${job.id}/picked-up`, { headers: rider, data: { pickupCode: d.pickupCode }, status: 200 });
    // At the door (ADR-030): the customer sees it; a cash order still needs the OTP (no door photo).
    const atDoor = await call(request, 'post', `/jobs/${job.id}/arrived-drop`, { headers: rider, status: 200 });
    expect(atDoor).toMatchObject({ photoProofAllowed: false, arrivedDropAt: expect.any(String) });
    const otp = (await call(request, 'get', `/orders/${order.id}/tracking`, { headers: customer.headers })).deliveryOtp;
    expect((await call(request, 'get', `/orders/${order.id}/tracking`, { headers: customer.headers })).arrivedDropAt).toBe(atDoor.arrivedDropAt);
    const done = await call(request, 'post', `/jobs/${job.id}/delivered`, { headers: rider, data: { otp, codCollectedPaise: order.totalPaise }, status: 200 });
    // The tip is collected with the cash and paid 100% to the rider (ADR-032).
    expect(done.payLines).toEqual(expect.arrayContaining([{ code: 'tip', amountPaise: 2_000 }]));
    expect((await call(request, 'get', `/orders/${order.id}`, { headers: customer.headers })).state).toBe('DELIVERED');

    await call(request, 'post', `/orders/${order.id}/rating`, { headers: customer.headers, data: { storeStars: 4, riderStars: 5 } });
    const rated = (await call(request, 'get', `/orders/${order.id}/rating`, { headers: customer.headers })).rating;
    expect(rated).toMatchObject({ storeStars: 4, riderStars: 5 });
    const home = await call(request, 'get', '/riders/me', { headers: rider });
    expect(home.rating).not.toBeNull();
    expect(home.today.deliveries).toBeGreaterThanOrEqual(1);
  });
});
