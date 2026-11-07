/**
 * M6 acceptance (fake mode): hybrid fulfilment, rider dispatch and tracking.
 *
 * BUILD-PLAN M6 acceptance:
 *  - an order delivered by the store's staff, with the commission ladder and delivery-fee credit visible in
 *    the merchant statement preview
 *  - an order delivered by a rider: offer → accept → pickup → OTP delivery
 *  - the fallback ladder starts after 5 min with no rider
 *  - live rider location reaches the customer (here: socket event per fix, measured) and ETAs update
 *  - ops can reassign (audited)
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!;
const centre = dargamitta.centre;
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / 111_195, lng: from.lng });
type StoreItem = { id: string; name: string; variants: Array<{ id: string; label: string; pricePaise: number }> };

let seq = 0;
const key = () => `m6-key-${Date.now()}-${++seq}`;

describe('M6 · hybrid fulfilment, dispatch and tracking (fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let items: StoreItem[];
  let store: { lat: number; lng: number };
  let staffId: string;
  let marketId: string;
  let baseUrl: string;
  const riders: Session[] = [];
  const http = () => fake.http();

  async function customer(phone: string) {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }
  async function order(c: Session & { addressId: string }, method: 'online' | 'cod' = 'cod') {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 3 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method }).expect(201)).body;
    if (method === 'online') await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    return { id: o.id as string, code: o.code as string, deliveryFee: (q.bill.fees as Array<{ code: string; amountPaise: number }>).find((f) => f.code === 'delivery')?.amountPaise ?? 0 };
  }
  const accept = (orderId: string, body: Record<string, unknown>) => http().post(`/v1/orders/${orderId}/accept`).set(owner.headers).send(body).expect(200);
  const ready = (orderId: string) => http().post(`/v1/orders/${orderId}/ready`).set(owner.headers).expect(200);
  const runTimers = () => http().post('/v1/dev/jobs/timers').expect(200);
  const advance = (minutes: number) => http().post('/v1/dev/clock').send({ minutes }).expect(200);
  const riderHome = async (r: Session) => (await http().get('/v1/riders/me').set(r.headers).expect(200)).body;
  const online = async (r: Session, at: { lat: number; lng: number }) => {
    await http().put('/v1/riders/me/status').set(r.headers).send({ online: true, zones: [marketId] }).expect(200);
    await http().post('/v1/riders/me/location').set(r.headers).send(at).expect(204);
  };
  const offline = (r: Session) => http().put('/v1/riders/me/status').set(r.headers).send({ online: false }).expect(200);
  /** Riders holding deliveries stay online (audit B3); with two jobs they get no more offers anyway. */
  const offlineIfFree = async (r: Session) => {
    if (!(await riderHome(r)).jobs.length) await offline(r);
  };
  const tracking = async (c: Session, orderId: string) => (await http().get(`/v1/orders/${orderId}/tracking`).set(c.headers).expect(200)).body;
  const delivery = async (orderId: string) => ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<Record<string, unknown>>).find((d) => d.orderId === orderId)!;
  const commsLog = async (orderId: string) => (await http().get(`/v1/ops/orders/${orderId}`).set((await fake.opsSignIn()).headers).expect(200)).body.comms as Array<{ template: string; channel: string; status: string }>;
  const comms = async (orderId: string) => (await commsLog(orderId)).map((c) => c.template);

  beforeAll(async () => {
    fake = await bootFakeApp();
    await fake.app.listen(0);
    baseUrl = `http://127.0.0.1:${(fake.app.getHttpServer().address() as AddressInfo).port}`;
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    store = me.merchant.location;
    marketId = me.merchant.microMarketId ?? me.microMarket.id;
    staffId = me.staff.find((s: { name: string }) => s.name === 'Suresh').id;
    items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items;
    for (const phone of ['9000000101', '9000000102', '9000000103']) riders.push(await fake.signIn(phone, 'rider'));
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: delivered by store staff — link, pickup, OTP; statement shows the lower commission and the delivery-fee credit', async () => {
    const c = await customer('9876500801');
    const o = await order(c, 'cod');
    await accept(o.id, { fulfilmentMode: 'self', staffId });
    const d = await delivery(o.id);
    expect(d).toMatchObject({ mode: 'self', state: 'assigned', courier: { kind: 'staff', name: 'Suresh' } });
    const token = String(d.staffLink).split('/d/')[1]!;
    expect(await comms(o.id)).toContain('staff.delivery_link');

    const job = (await http().get(`/v1/staff-jobs/${token}`).expect(200)).body;
    expect(job).toMatchObject({ code: o.code, pickupCodeRequired: false, payPaise: 0 });
    expect(job.codDuePaise).toBeGreaterThan(0);
    expect((await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(409)).body.error.code).toBe('NOT_READY');
    await ready(o.id);
    await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(200);

    const t = await tracking(c, o.id);
    expect(t).toMatchObject({ mode: 'self', state: 'picked_up', courier: { kind: 'staff', name: 'Suresh' } });
    expect(t.deliveryOtp).toMatch(/^\d{4}$/);
    expect(t.courier.callNumber).toMatch(/^\+9180471\d{5}$/); // masked, never the staff's phone
    await http().post(`/v1/staff-jobs/${token}/location`).send(north(store, 300)).expect(204);
    expect((await tracking(c, o.id)).courierLocation).toMatchObject(north(store, 300));

    const wrong = t.deliveryOtp === '0000' ? '1111' : '0000';
    expect((await http().post(`/v1/staff-jobs/${token}/delivered`).send({ otp: wrong, codCollectedPaise: job.codDuePaise }).expect(422)).body.error.code).toBe('WRONG_CODE');
    await http().post(`/v1/staff-jobs/${token}/delivered`).send({ otp: t.deliveryOtp, codCollectedPaise: job.codDuePaise }).expect(200);
    expect((await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body.state).toBe('DELIVERED');
    expect((await tracking(c, o.id)).courierLocation).toBeNull(); // location sharing ends at delivery

    const st = (await http().get('/v1/merchants/me/statements/preview').set(owner.headers).expect(200)).body;
    const lineFor = st.lines.find((l: { orderId: string }) => l.orderId === o.id);
    expect(lineFor).toMatchObject({ mode: 'self', commissionPercent: 6, deliveryFeeCreditPaise: o.deliveryFee });
    expect(lineFor.commissionPaise).toBe(Math.round((lineFor.itemsPaise * 6) / 100));
    expect(lineFor.netPaise).toBe(lineFor.itemsPaise - lineFor.commissionPaise + lineFor.deliveryFeeCreditPaise);
  });

  it('ACCEPTANCE: delivered by a rider — offer to the nearest, decline → next, accept, pickup code, OTP, pay', async () => {
    const [near, far, third] = riders as [Session, Session, Session];
    await online(near, north(store, 300));
    await online(far, north(store, 1500));
    await offline(third);
    const c = await customer('9876500802');
    const o = await order(c, 'online');
    await accept(o.id, { fulfilmentMode: 'rider' });
    expect((await delivery(o.id)).state).toBe('searching');

    const first = (await riderHome(near)).offer;
    expect(first.pickup).toMatchObject({ name: 'Ramesh Stores' });
    expect(first.drop.area).toBe('Dargamitta'); // area only before accepting
    expect(first.payLines.map((l: { code: string }) => l.code)).toEqual(['base', 'distance']);
    expect(first.payPaise).toBe(first.payLines.reduce((s: number, l: { amountPaise: number }) => s + l.amountPaise, 0));
    expect((await riderHome(far)).offer).toBeNull();
    // Someone else's offer is not yours to take.
    await http().post(`/v1/offers/${first.id}/accept`).set(far.headers).expect(404);
    await http().post(`/v1/offers/${first.id}/decline`).set(near.headers).expect(204);

    const second = (await riderHome(far)).offer;
    expect(second).not.toBeNull();
    const job = (await http().post(`/v1/offers/${second.id}/accept`).set(far.headers).expect(200)).body;
    expect(job).toMatchObject({ code: o.code, state: 'assigned', pickupCodeRequired: true, codDuePaise: 0 });
    expect(job.drop.line).toContain('Dargamitta Main Road'); // revealed after assignment
    const d = await delivery(o.id);
    expect(d).toMatchObject({ mode: 'rider', state: 'assigned', courier: { kind: 'rider', name: 'Demo Rider 2' } });

    await http().post(`/v1/jobs/${job.id}/arrived`).set(far.headers).expect(200);
    const wrong = d.pickupCode === '0000' ? '1111' : '0000';
    expect((await http().post(`/v1/jobs/${job.id}/picked-up`).set(far.headers).send({ pickupCode: wrong }).expect(422)).body.error.code).toBe('WRONG_CODE');
    expect((await http().post(`/v1/jobs/${job.id}/picked-up`).set(far.headers).send({ pickupCode: d.pickupCode }).expect(409)).body.error.code).toBe('NOT_READY');
    await ready(o.id);
    await http().post(`/v1/jobs/${job.id}/picked-up`).set(far.headers).send({ pickupCode: d.pickupCode }).expect(200);
    expect((await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body.state).toBe('OUT_FOR_DELIVERY');

    // Live location: every fix reaches the customer's socket at once, with a fresh ETA.
    const socket: Socket = io(baseUrl, { path: '/v1/realtime', transports: ['websocket'], auth: { token: c.accessToken, deviceId: c.deviceId } });
    await new Promise<void>((resolve, reject) => {
      socket.once('ready', () => resolve());
      setTimeout(() => reject(new Error('no ready')), 15_000);
    });
    const t0 = Date.now();
    const fix = new Promise<{ orderId: string; lat: number; etaAt: string }>((resolve) => socket.once('order.location', resolve));
    await http().post('/v1/riders/me/location').set(far.headers).send(north(store, 500)).expect(204);
    const got = await fix;
    socket.disconnect();
    expect(got.orderId).toBe(o.id);
    expect(Date.now() - t0).toBeLessThan(2000);
    const t = await tracking(c, o.id);
    expect(t.etaAt).toBe(got.etaAt);
    expect(t.courier).toMatchObject({ kind: 'rider', name: 'Demo Rider 2' });

    // Far off course: the customer is told once that it's running late.
    await http().post('/v1/riders/me/location').set(far.headers).send(north(store, -12_000)).expect(204);
    await http().post('/v1/riders/me/location').set(far.headers).send(north(store, -12_100)).expect(204);
    // Once: the customer has no push token in this test, so one SMS (and one skipped push in the log).
    expect((await commsLog(o.id)).filter((x) => x.template === 'customer.delivery_delayed' && x.status === 'sent')).toHaveLength(1);

    // Audit B1: a made-up "door photo" id no longer skips the customer's OTP.
    const fakePhoto = await http().post(`/v1/jobs/${job.id}/delivered`).set(far.headers).send({ photoMediaId: '6f1c2d3e-4a5b-4c6d-8e7f-001122334455' }).expect(400);
    expect(fakePhoto.body.error.code).toBe('VALIDATION_FAILED');
    // Mid-delivery the rider can't go offline (audit B3).
    expect((await http().put('/v1/riders/me/status').set(far.headers).send({ online: false }).expect(409)).body.error.code).toBe('RIDER_HAS_ACTIVE_JOB');

    await http().post(`/v1/jobs/${job.id}/delivered`).set(far.headers).send({ otp: t.deliveryOtp }).expect(200);
    expect((await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body.state).toBe('DELIVERED');
    const earnings = (await http().get('/v1/riders/me/earnings').set(far.headers).expect(200)).body;
    expect(earnings.deliveries.find((x: { code: string }) => x.code === o.code).payPaise).toBe(second.payPaise);
    expect((await riderHome(far)).today.deliveries).toBe(1);

    const st = (await http().get('/v1/merchants/me/statements/preview').set(owner.headers).expect(200)).body;
    expect(st.lines.find((l: { orderId: string }) => l.orderId === o.id)).toMatchObject({ mode: 'rider', commissionPercent: 9, deliveryFeeCreditPaise: 0 });
    await offline(near);
    await offline(far);
  });

  it('an unanswered offer expires after 30 s and goes to the next rider; a late accept is refused', async () => {
    const [a, b] = riders as [Session, Session];
    await online(a, north(store, 200));
    await online(b, north(store, 800));
    const c = await customer('9876500803');
    const o = await order(c, 'cod');
    await accept(o.id, { fulfilmentMode: 'rider' });
    const offer = (await riderHome(a)).offer;
    await advance(0.6); // 36 s
    await runTimers();
    expect((await http().post(`/v1/offers/${offer.id}/accept`).set(a.headers).expect(409)).body.error.code).toBe('OFFER_EXPIRED');
    expect((await riderHome(b)).offer).not.toBeNull();
    await offline(a);
    await offline(b);
    expect((await riderHome(b)).offer).toBeNull(); // going offline declines it
  });

  it('a second order from the same store is batched onto a rider already on the way (batch bonus)', async () => {
    // The third rider: this test leaves them with two open jobs.
    const a = riders[2]!;
    await online(a, north(store, 300));
    const c = await customer('9876500804');
    const first = await order(c, 'cod');
    await accept(first.id, { fulfilmentMode: 'rider' });
    await http().post(`/v1/offers/${(await riderHome(a)).offer.id}/accept`).set(a.headers).expect(200);
    const second = await order(await customer('9876500805'), 'cod');
    await accept(second.id, { fulfilmentMode: 'rider' });
    const offer = (await riderHome(a)).offer;
    expect(offer.payLines.map((l: { code: string }) => l.code)).toContain('batch');
    await http().post(`/v1/offers/${offer.id}/accept`).set(a.headers).expect(200);
    expect((await riderHome(a)).jobs).toHaveLength(2);
    // With deliveries in hand the rider stays online (audit B3); two jobs is the cap, so no more offers come.
    expect((await http().put('/v1/riders/me/status').set(a.headers).send({ online: false }).expect(409)).body.error.code).toBe('RIDER_HAS_ACTIVE_JOB');
  });

  it('ACCEPTANCE: no rider for 5 min → fallback ladder (3PL → self-delivery bonus → standby → customer told, may cancel with a refund)', async () => {
    for (const r of riders) await offlineIfFree(r);
    const c = await customer('9876500806');
    const o = await order(c, 'online');
    const total = (await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body.totalPaise as number;
    await accept(o.id, { fulfilmentMode: 'rider' });
    await advance(4);
    await runTimers();
    expect((await delivery(o.id)).fallbackStage).toBe('none');
    await advance(1.1);
    await runTimers();
    expect((await delivery(o.id)).fallbackStage).toBe('tpl'); // mock 3PL has no capacity
    await advance(2.1);
    await runTimers();
    expect(await delivery(o.id)).toMatchObject({ fallbackStage: 'self_bonus', selfBonusPaise: 2000 });
    expect(await comms(o.id)).toContain('merchant.self_delivery_bonus');
    expect((await tracking(c, o.id)).canCancelNoCourier).toBe(false);
    await advance(2.1);
    await runTimers();
    expect((await delivery(o.id)).fallbackStage).toBe('standby');
    await advance(2.1);
    await runTimers();
    const t = await tracking(c, o.id);
    expect(t).toMatchObject({ fallbackStage: 'customer_notified', canCancelNoCourier: true, courier: null });
    expect(await comms(o.id)).toContain('customer.finding_courier');

    const ops = (await fake.opsSignIn()).headers;
    const live = (await http().get('/v1/ops/live').set(ops).expect(200)).body;
    expect(live.attention.find((x: { code: string | null }) => x.code === o.code)).toMatchObject({ kind: 'no_rider', stage: 'customer_notified' });

    const before = (await http().get('/v1/wallet').set(c.headers).expect(200)).body.balancePaise as number;
    await http().post(`/v1/orders/${o.id}/cancel-no-courier`).set(c.headers).expect(204);
    expect((await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body).toMatchObject({ state: 'CANCELLED', outcomeReason: 'no_courier', refundedPaise: total });
    expect((await http().get('/v1/wallet').set(c.headers).expect(200)).body.balancePaise).toBe(before + total);
  });

  it('the store takes the bonus and delivers itself; the statement shows the bonus', async () => {
    for (const r of riders) await offlineIfFree(r);
    const c = await customer('9876500807');
    const o = await order(c, 'cod');
    await accept(o.id, { fulfilmentMode: 'rider' });
    await advance(5.1);
    await runTimers();
    await advance(2.1);
    await runTimers();
    expect((await delivery(o.id)).selfBonusPaise).toBe(2000);
    const d = (await http().post(`/v1/merchants/me/orders/${o.id}/deliver-myself`).set(owner.headers).send({}).expect(200)).body;
    expect(d).toMatchObject({ mode: 'self', state: 'assigned', courier: { kind: 'owner' } });
    const token = String(d.staffLink).split('/d/')[1]!;
    await ready(o.id);
    await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(200);
    const t = await tracking(c, o.id);
    const due = (await http().get(`/v1/staff-jobs/${token}`).expect(200)).body.codDuePaise;
    await http().post(`/v1/staff-jobs/${token}/delivered`).send({ otp: t.deliveryOtp, codCollectedPaise: due }).expect(200);
    const st = (await http().get('/v1/merchants/me/statements/preview').set(owner.headers).expect(200)).body;
    expect(st.lines.find((l: { orderId: string }) => l.orderId === o.id)).toMatchObject({ mode: 'self', selfBonusPaise: 2000 });
  });

  it('ACCEPTANCE: ops sees the live board and reassigns a delivery to another rider (audited)', async () => {
    const [a, b] = riders as [Session, Session];
    await online(a, north(store, 200));
    await online(b, north(store, 2500));
    const c = await customer('9876500808');
    const o = await order(c, 'cod');
    await accept(o.id, { fulfilmentMode: 'rider' });
    await http().post(`/v1/offers/${(await riderHome(a)).offer.id}/accept`).set(a.headers).expect(200);

    const ops = (await fake.opsSignIn()).headers;
    const live = (await http().get('/v1/ops/live').set(ops).expect(200)).body;
    expect(live.kpis.ridersOnline).toBeGreaterThanOrEqual(2);
    expect(live.kpis.ordersToday).toBeGreaterThan(0);
    expect(live.orders.find((x: { code: string }) => x.code === o.code)).toMatchObject({ mode: 'rider', fulfilmentState: 'assigned', courier: 'Demo Rider 1' });
    expect(live.riders.find((r: { name: string }) => r.name === 'Demo Rider 1').activeJobs).toBe(1);

    const bId = (await riderHome(b)) && live.riders.find((r: { name: string }) => r.name === 'Demo Rider 2').userId;
    const row = (await http().post(`/v1/ops/orders/${o.id}/reassign`).set(ops).send({ riderUserId: bId }).expect(200)).body;
    expect(row).toMatchObject({ courier: 'Demo Rider 2', fulfilmentState: 'assigned' });
    expect((await riderHome(a)).jobs).toHaveLength(0);
    expect((await riderHome(b)).jobs.map((j: { orderId: string }) => j.orderId)).toContain(o.id);
    const audit = (await http().get(`/v1/ops/audit?entity=order&entityId=${o.id}`).set(ops).expect(200)).body.items;
    expect(audit.map((x: { action: string }) => x.action)).toContain('dispatch.reassigned');

    await http().post(`/v1/ops/orders/${o.id}/force-self`).set(ops).send({ staffId }).expect(200);
    expect(await delivery(o.id)).toMatchObject({ mode: 'self', courier: { name: 'Suresh' } });
    await offline(a);
    await offline(b);
  });

  it('roles and links are enforced', async () => {
    const c = await customer('9876500809');
    await http().get('/v1/riders/me').set(c.headers).expect(403);
    await http().get('/v1/ops/live').set(owner.headers).expect(403);
    await http().get('/v1/staff-jobs/not-a-real-token').expect(404);
    const o = await order(c, 'cod');
    await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(404); // not accepted yet
    const other = await customer('9876500810');
    await accept(o.id, { fulfilmentMode: 'self' });
    await http().get(`/v1/orders/${o.id}/tracking`).set(other.headers).expect(404);
    await http().post(`/v1/orders/${o.id}/cancel-no-courier`).set(c.headers).expect(409);
    await accept((await order(c, 'cod')).id, { fulfilmentMode: 'self', staffId: '00000000-0000-4000-8000-000000000000' }).catch(() => undefined);
  });
});
