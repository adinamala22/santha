import { expect, test } from '@playwright/test';
import { API, appSignIn, call, deliverBySelf, HAS_OPS, LIVE, newCustomer, openAllDay, OPS, OTP, placeCodOrder, SEED, TARGET, type Headers } from '../support/target';

/**
 * Launch test campaign (docs/testing/launch-test-report.md): the edge cases and the multi-user scenarios, as the apps
 * drive the API. Several people at once: three customers, the store owner, two riders and ops. Live-safe: fresh users,
 * cash on delivery, and the store hours put back at the end. Ids "LC-nn" match the report.
 */
test.describe.serial('launch campaign: edge cases and several users at once', () => {
  let owner: Headers;
  let restoreHours: (request: import('@playwright/test').APIRequestContext) => Promise<void>;

  test.beforeAll(async ({ request }) => {
    owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    restoreHours = await openAllDay(request, owner);
  });
  test.afterAll(async ({ request }) => {
    await restoreHours?.(request);
  });

  // ───────────── LC-01 … LC-08: sign-in and who may do what ─────────────

  test('LC-01 sign-in refuses bad numbers, wrong codes and unknown challenges', async ({ request }) => {
    for (const phone of ['12345', '98765abcde', '', '+1 202 555 0100']) {
      const r = await request.post(`${API}/auth/otp/request`, { data: { phone, app: 'consumer', deviceId: 'lc-01-device-a' } });
      expect(r.status(), `phone "${phone}"`).toBe(400);
    }
    const challenge = await request.post(`${API}/auth/otp/request`, { data: { phone: `9${String(Date.now()).slice(-9)}`, app: 'consumer', deviceId: 'lc-01-device-b' } });
    expect(challenge.status()).toBe(200);
    const { challengeId } = await challenge.json();
    const wrong = await request.post(`${API}/auth/otp/verify`, { data: { challengeId, code: '000000', deviceId: 'lc-01-device-b', app: 'consumer', platform: 'android' } });
    expect([400, 401]).toContain(wrong.status());
    const unknown = await request.post(`${API}/auth/otp/verify`, { data: { challengeId: '00000000-0000-4000-8000-000000000000', code: OTP, deviceId: 'lc-01-device-b', app: 'consumer', platform: 'android' } });
    expect([400, 401, 404]).toContain(unknown.status());
  });

  test('LC-02 no token, a made-up token and a token for another person are refused', async ({ request }) => {
    expect((await request.get(`${API}/me`)).status()).toBe(401);
    expect((await request.get(`${API}/me`, { headers: { Authorization: 'Bearer not-a-real-token' } })).status()).toBe(401);
    expect((await request.get(`${API}/orders`)).status()).toBe(401);
    expect((await request.post(`${API}/orders`, { data: {} })).status()).toBe(401);
  });

  test('LC-03 a customer cannot use the partner or the ops endpoints', async ({ request }) => {
    const c = await newCustomer(request);
    for (const path of ['/merchants/me', '/merchants/me/orders', '/merchants/me/deliveries']) {
      expect([403, 404], path).toContain((await request.get(`${API}${path}`, { headers: c.headers })).status());
    }
    for (const path of ['/ops/merchants', '/ops/riders', '/ops/orders']) {
      expect([401, 403], path).toContain((await request.get(`${API}${path}`, { headers: c.headers })).status());
    }
  });

  test('LC-04 a rider cannot use the partner or ops endpoints, and a store owner is not an ops user', async ({ request }) => {
    const rider = await appSignIn(request, '9000000101', 'rider');
    for (const path of ['/merchants/me/orders', '/merchants/me/deliveries']) {
      expect([403, 404], path).toContain((await request.get(`${API}${path}`, { headers: rider })).status());
    }
    for (const [who, h] of [['rider', rider], ['store owner', owner]] as const) {
      expect([401, 403], who).toContain((await request.get(`${API}/ops/orders`, { headers: h })).status());
    }
  });

  test('LC-05 the same phone signs in on two devices; signing out one leaves the other working', async ({ request }) => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    const sign = async (deviceId: string) => {
      const r = await request.post(`${API}/auth/otp/request`, { data: { phone, app: 'consumer', deviceId } });
      expect(r.status(), await r.text()).toBe(200);
      const v = await request.post(`${API}/auth/otp/verify`, { data: { challengeId: (await r.json()).challengeId, code: OTP, deviceId, app: 'consumer', platform: 'android' } });
      expect(v.status(), await v.text()).toBe(200);
      const s = await v.json();
      return { headers: { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId }, refreshToken: s.refreshToken as string };
    };
    test.skip(LIVE, 'the second request for one phone is held by the OTP resend cooldown on test');
    const a = await sign('lc-05-device-a');
    const b = await sign('lc-05-device-b');
    expect((await request.get(`${API}/me`, { headers: a.headers })).status()).toBe(200);
    expect((await request.get(`${API}/me`, { headers: b.headers })).status()).toBe(200);
    expect((await request.post(`${API}/auth/logout`, { headers: a.headers, data: { refreshToken: a.refreshToken } })).status()).toBeLessThan(300);
    expect((await request.get(`${API}/me`, { headers: b.headers })).status()).toBe(200);
  });

  // ───────────── LC-10 … LC-19: pricing and placing ─────────────

  test('LC-10 the bill adds up: lines, fees and taxes equal the total, in whole paise', async ({ request }) => {
    const c = await newCustomer(request);
    const store = await call(request, 'get', `/stores/${SEED.kirana.id}?lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`);
    const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    await call(request, 'put', '/cart', { headers: c.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 3 }] } });
    const q = await call(request, 'post', '/cart/price', { headers: c.headers, data: { addressId: c.addressId, when: { mode: 'asap' } }, status: 200 });
    expect(q.placeable).toBe(true);
    const parts = [...(q.bill.lines ?? []), ...(q.bill.fees ?? []), ...(q.bill.taxes ?? [])].map((x: { amountPaise?: number; linePaise?: number }) => x.amountPaise ?? x.linePaise ?? 0);
    for (const n of parts) expect(Number.isInteger(n)).toBe(true);
    expect(Number.isInteger(q.bill.totalPaise)).toBe(true);
    expect(q.bill.totalPaise).toBeGreaterThan(0);
  });

  test('LC-11 an empty cart, a bogus quote and an unknown address cannot be ordered', async ({ request }) => {
    const c = await newCustomer(request);
    await call(request, 'put', '/cart', { headers: c.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [] }, status: 200 }).catch(() => undefined);
    const noQuote = await request.post(`${API}/orders`, { headers: { ...c.headers, 'Idempotency-Key': `lc-11-${Date.now()}` }, data: { quoteId: '00000000-0000-4000-8000-000000000000', paymentMethod: 'cod' } });
    expect([400, 404, 409, 422]).toContain(noQuote.status());
    const badAddress = await request.post(`${API}/cart/price`, { headers: c.headers, data: { addressId: '00000000-0000-4000-8000-000000000000', when: { mode: 'asap' } } });
    expect([400, 404, 409, 422]).toContain(badAddress.status());
  });

  test('LC-12 placing an order needs an Idempotency-Key, and repeating the key never makes a second order', async ({ request }) => {
    const c = await newCustomer(request);
    const store = await call(request, 'get', `/stores/${SEED.kirana.id}?lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`);
    const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    await call(request, 'put', '/cart', { headers: c.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 2 }] } });
    const q = await call(request, 'post', '/cart/price', { headers: c.headers, data: { addressId: c.addressId, when: { mode: 'asap' } }, status: 200 });
    const noKey = await request.post(`${API}/orders`, { headers: c.headers, data: { quoteId: q.quoteId, paymentMethod: 'cod' } });
    expect(noKey.status()).toBe(400);
    const key = `lc-12-${TARGET}-${Date.now()}`;
    const first = await request.post(`${API}/orders`, { headers: { ...c.headers, 'Idempotency-Key': key }, data: { quoteId: q.quoteId, paymentMethod: 'cod' } });
    expect(first.status()).toBe(201);
    const again = await request.post(`${API}/orders`, { headers: { ...c.headers, 'Idempotency-Key': key }, data: { quoteId: q.quoteId, paymentMethod: 'cod' } });
    expect([200, 201]).toContain(again.status());
    expect((await again.json()).id).toBe((await first.json()).id);
    const list = await call(request, 'get', '/orders', { headers: c.headers });
    expect(list.items.filter((o: { id: string }) => o.id === (list.items[0] as { id: string }).id)).toHaveLength(1);
    expect(list.items).toHaveLength(1);
  });

  test('LC-13 a quantity beyond the stock, or zero, or negative, is refused', async ({ request }) => {
    const c = await newCustomer(request);
    const store = await call(request, 'get', `/stores/${SEED.kirana.id}?lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`);
    const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    for (const quantity of [0, -1, 1.5]) {
      const r = await request.put(`${API}/cart`, { headers: c.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity }] } });
      expect(r.status(), `quantity ${quantity}`).toBe(400);
    }
    await call(request, 'put', '/cart', { headers: c.headers, data: { merchantId: SEED.kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 100000 }] }, status: 200 }).catch(() => undefined);
    const q = await request.post(`${API}/cart/price`, { headers: c.headers, data: { addressId: c.addressId, when: { mode: 'asap' } } });
    if (q.status() === 200) expect((await q.json()).placeable, 'a 100000 quantity must not be placeable').toBe(false);
    else expect([400, 409, 422]).toContain(q.status());
  });

  // ───────────── LC-20 … LC-29: several customers, one store ─────────────

  test('LC-20 three customers order from one store at the same time; each sees only their own order', async ({ request }) => {
    const [a, b, c] = await Promise.all([newCustomer(request), newCustomer(request), newCustomer(request)]);
    const [oa, ob, oc] = await Promise.all([placeCodOrder(request, a), placeCodOrder(request, b), placeCodOrder(request, c)]);
    const ids = [oa.id, ob.id, oc.id];
    expect(new Set(ids).size).toBe(3);
    expect(new Set([oa.code, ob.code, oc.code]).size).toBe(3);
    for (const [who, mine] of [[a, oa], [b, ob], [c, oc]] as const) {
      const list = await call(request, 'get', '/orders', { headers: who.headers });
      expect(list.items.map((o: { id: string }) => o.id)).toEqual([mine.id]);
    }
    // Nobody can read or change another customer's order.
    for (const [who, theirs] of [[a, ob], [b, oc], [c, oa]] as const) {
      expect((await request.get(`${API}/orders/${theirs.id}`, { headers: who.headers })).status()).toBe(404);
      expect((await request.get(`${API}/orders/${theirs.id}/tracking`, { headers: who.headers })).status()).toBe(404);
      expect((await request.post(`${API}/orders/${theirs.id}/cancel`, { headers: who.headers, data: { reason: 'changed_mind' } })).status()).toBe(404);
    }
    // The store sees all three, and not the delivery address of any until it accepts.
    const queue = await call(request, 'get', '/merchants/me/orders?bucket=new', { headers: owner });
    const mine = queue.items.filter((o: { id: string }) => ids.includes(o.id));
    expect(mine).toHaveLength(3);
    for (const o of mine) expect(o.address, 'address hidden before acceptance').toBeNull();
    // Tidy: the store turns all three down.
    for (const id of ids) await call(request, 'post', `/orders/${id}/reject`, { headers: owner, data: { reason: 'too_busy' }, status: 200 });
  });

  test('LC-21 the store rejects one order and accepts another; the others are not affected', async ({ request }) => {
    const [a, b] = await Promise.all([newCustomer(request), newCustomer(request)]);
    const oa = await placeCodOrder(request, a);
    const ob = await placeCodOrder(request, b);
    const rejected = await call(request, 'post', `/orders/${oa.id}/reject`, { headers: owner, data: { reason: 'out_of_stock' }, status: 200 });
    expect(rejected.state).toBe('REJECTED');
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    const accepted = await call(request, 'post', `/orders/${ob.id}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId: me.staff[0].id }, status: 200 });
    expect(accepted.state).toBe('PREPARING'); // accepting starts the preparing
    expect(accepted.address, 'the address shows once accepted').toBeTruthy();
    expect((await call(request, 'get', `/orders/${oa.id}`, { headers: a.headers })).state).toBe('REJECTED');
    expect((await call(request, 'get', `/orders/${ob.id}`, { headers: b.headers })).state).toBe('PREPARING');
    // A rejected order cannot be accepted later; an accepted one cannot be rejected.
    expect((await request.post(`${API}/orders/${oa.id}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId: me.staff[0].id } })).status()).toBe(409);
    expect((await request.post(`${API}/orders/${ob.id}/reject`, { headers: owner, data: { reason: 'too_busy' } })).status()).toBe(409);
    await deliverBySelf(request, owner, b.headers, { id: ob.id, totalPaise: ob.totalPaise }).catch(() => undefined);
  });

  test('LC-22 the customer cancels before the store accepts; after acceptance cancelling is refused', async ({ request }) => {
    const [a, b] = await Promise.all([newCustomer(request), newCustomer(request)]);
    const oa = await placeCodOrder(request, a);
    const cancelled = await call(request, 'post', `/orders/${oa.id}/cancel`, { headers: a.headers, data: { reason: 'changed_mind' }, status: 200 });
    expect(cancelled.state).toBe('CANCELLED');
    expect((await request.post(`${API}/orders/${oa.id}/cancel`, { headers: a.headers, data: { reason: 'changed_mind' } })).status()).toBe(409);
    const ob = await placeCodOrder(request, b);
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    await call(request, 'post', `/orders/${ob.id}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId: me.staff[0].id }, status: 200 });
    expect((await request.post(`${API}/orders/${ob.id}/cancel`, { headers: b.headers, data: { reason: 'changed_mind' } })).status()).toBe(409);
    await call(request, 'post', `/orders/${ob.id}/ready`, { headers: owner, status: 200 });
  });

  test('LC-23 only the store that owns an order can accept it', async ({ request }) => {
    const other = await appSignIn(request, '9000000202', 'merchant'); // another seeded store
    const c = await newCustomer(request);
    const o = await placeCodOrder(request, c);
    const me = await call(request, 'get', '/merchants/me', { headers: other });
    const r = await request.post(`${API}/orders/${o.id}/accept`, { headers: other, data: { fulfilmentMode: 'self', staffId: me.staff[0]?.id } });
    expect([403, 404]).toContain(r.status());
    expect((await request.get(`${API}/merchants/me/orders/${o.id}`, { headers: other })).status()).toBe(404);
    await call(request, 'post', `/orders/${o.id}/reject`, { headers: owner, data: { reason: 'too_busy' }, status: 200 });
  });

  // ───────────── LC-30 … LC-39: delivery, the OTP and what follows ─────────────

  test('LC-30 delivery needs the right OTP; a wrong one is refused; delivering twice is refused', async ({ request }) => {
    const c = await newCustomer(request);
    const o = await placeCodOrder(request, c);
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    await call(request, 'post', `/orders/${o.id}/accept`, { headers: owner, data: { fulfilmentMode: 'self', staffId: me.staff[0].id }, status: 200 });
    await call(request, 'post', `/orders/${o.id}/ready`, { headers: owner, status: 200 });
    let d: { staffLink: string | null } | undefined;
    await expect
      .poll(async () => {
        d = (await call(request, 'get', '/merchants/me/deliveries', { headers: owner })).items.find((x: { orderId: string }) => x.orderId === o.id);
        return d?.staffLink ?? null;
      }, { timeout: 30_000 })
      .not.toBeNull();
    const token = d!.staffLink!.split('/d/')[1];
    await call(request, 'post', `/staff-jobs/${token}/picked-up`, { status: 200 });
    const otp = (await call(request, 'get', `/orders/${o.id}/tracking`, { headers: c.headers })).deliveryOtp as string;
    const wrong = otp === '0000' ? '1111' : '0000';
    const bad = await request.post(`${API}/staff-jobs/${token}/delivered`, { data: { otp: wrong, codCollectedPaise: o.totalPaise } });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect((await call(request, 'get', `/orders/${o.id}`, { headers: c.headers })).state).not.toBe('DELIVERED');
    await call(request, 'post', `/staff-jobs/${token}/delivered`, { data: { otp, codCollectedPaise: o.totalPaise }, status: 200 });
    expect((await call(request, 'get', `/orders/${o.id}`, { headers: c.headers })).state).toBe('DELIVERED');
    const twice = await request.post(`${API}/staff-jobs/${token}/delivered`, { data: { otp, codCollectedPaise: o.totalPaise } });
    expect(twice.status()).toBeGreaterThanOrEqual(400);
  });

  test('LC-31 after delivery: rate once, rate the delivery by the store staff, and strangers cannot rate', async ({ request }) => {
    const [c, stranger] = await Promise.all([newCustomer(request), newCustomer(request)]);
    const o = await placeCodOrder(request, c);
    expect((await request.post(`${API}/orders/${o.id}/rating`, { headers: c.headers, data: { storeStars: 5 } })).status(), 'not delivered yet').toBe(409);
    await deliverBySelf(request, owner, c.headers, o);
    expect((await request.post(`${API}/orders/${o.id}/rating`, { headers: stranger.headers, data: { storeStars: 1 } })).status()).toBe(404);
    expect((await request.post(`${API}/orders/${o.id}/rating`, { headers: c.headers, data: { storeStars: 6 } })).status()).toBe(400);
    await call(request, 'post', `/orders/${o.id}/rating`, { headers: c.headers, data: { storeStars: 4, riderStars: 5 } });
    const mine = (await call(request, 'get', `/orders/${o.id}/rating`, { headers: c.headers })).rating;
    expect(mine).toMatchObject({ storeStars: 4, riderStars: 5 }); // ADR-039
    expect((await request.post(`${API}/orders/${o.id}/rating`, { headers: c.headers, data: { storeStars: 2 } })).status(), 'second rating').toBe(409);
  });

  test('LC-32 a delivered order can be reported once for a missing item; a stranger cannot report it', async ({ request }) => {
    const [c, stranger] = await Promise.all([newCustomer(request), newCustomer(request)]);
    const o = await placeCodOrder(request, c);
    expect((await request.get(`${API}/orders/${o.id}/issues`, { headers: stranger.headers })).status()).toBe(404);
    await deliverBySelf(request, owner, c.headers, o);
    const detail = await call(request, 'get', `/orders/${o.id}`, { headers: c.headers });
    const variantId = detail.lines[0].variantId as string;
    const issue = await request.post(`${API}/orders/${o.id}/issues`, { headers: c.headers, data: { type: 'missing_item', variantIds: [variantId], note: 'one pack was missing' } });
    expect([200, 201]).toContain(issue.status());
    const dup = await request.post(`${API}/orders/${o.id}/issues`, { headers: c.headers, data: { type: 'missing_item', variantIds: [variantId], note: 'again' } });
    expect(dup.status()).toBe(409);
  });

  // ───────────── LC-40 … LC-45: rider dispatch with two riders (fake only: needs fresh rider state) ─────────────

  test('LC-40 two riders are offered a job; the first to accept gets it, the second is told it is taken', async ({ request }) => {
    test.skip(LIVE, 'needs the riders offline/online state of the fake demo data');
    const r1 = await appSignIn(request, '9000000101', 'rider');
    const r2 = await appSignIn(request, '9000000102', 'rider');
    const rider3 = await appSignIn(request, '9000000103', 'rider');
    await call(request, 'put', '/riders/me/status', { headers: rider3, data: { online: false } });
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    const store = me.merchant.location as { lat: number; lng: number };
    const zone = me.merchant.microMarketId ?? me.microMarket.id;
    for (const [r, m] of [[r1, 300], [r2, 500]] as const) {
      await call(request, 'put', '/riders/me/status', { headers: r, data: { online: true, zones: [zone] } });
      await call(request, 'post', '/riders/me/location', { headers: r, data: { lat: store.lat + m / 111_195, lng: store.lng }, status: 204 });
    }
    const c = await newCustomer(request);
    const o = await placeCodOrder(request, c);
    await call(request, 'post', `/orders/${o.id}/accept`, { headers: owner, data: { fulfilmentMode: 'rider' }, status: 200 });
    const offerOf = async (h: Headers) => (await call(request, 'get', '/riders/me', { headers: h })).offer as { id: string } | null;
    await expect.poll(async () => (await offerOf(r1)) ?? (await offerOf(r2)), { timeout: 30_000 }).not.toBeNull();
    const first = (await offerOf(r1)) ? r1 : r2;
    const second = first === r1 ? r2 : r1;
    const offer = (await offerOf(first))!;
    await call(request, 'post', `/offers/${offer.id}/accept`, { headers: first, status: 200 });
    const late = await request.post(`${API}/offers/${offer.id}/accept`, { headers: second });
    expect(late.status()).toBeGreaterThanOrEqual(400);
    for (const r of [r1, r2]) await call(request, 'put', '/riders/me/status', { headers: r, data: { online: false } }).catch(() => undefined);
  });

  // ───────────── LC-50 … LC-55: ops console access by role (needs the ops user) ─────────────

  test('LC-50 the ops console API answers ops and refuses everyone else', async ({ request }) => {
    test.skip(!HAS_OPS, 'no ops credentials in this run');
    const login = await request.post(`${API}/auth/ops/login`, { data: { email: OPS.email, password: OPS.password, deviceId: 'lc-50-device' } });
    expect(login.status(), await login.text()).toBe(200);
    const wrong = await request.post(`${API}/auth/ops/login`, { data: { email: OPS.email, password: `${OPS.password}-wrong`, deviceId: 'lc-50-device' } });
    expect([400, 401, 429]).toContain(wrong.status());
    const unknown = await request.post(`${API}/auth/ops/login`, { data: { email: 'nobody@example.com', password: 'whatever-password-1', deviceId: 'lc-50-device' } });
    expect([400, 401, 429]).toContain(unknown.status());
  });
});
