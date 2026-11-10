/**
 * Door-photo proof and "arrived at the customer" (ADR-030), fake mode:
 *  - the rider marks arrived at the door: the customer is told, the job shows when;
 *  - prepaid orders up to ₹2,000 may be delivered with a door photo instead of the OTP, after arriving;
 *  - the photo must be this rider's door photo for this job (not another job's, not someone else's, not made up);
 *  - cash orders always need the OTP;
 *  - the customer sees the door photo through a short-lived private link.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / 111_195, lng: from.lng });
type StoreItem = { id: string; name: string; variants: Array<{ id: string }> };

let seq = 0;
const key = () => `pp-key-${Date.now()}-${++seq}`;

describe('Door-photo proof and arrived at the customer (ADR-030, fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let ops: Session['headers'];
  let rider: Session;
  let other: Session;
  let items: StoreItem[];
  let store: { lat: number; lng: number };
  let marketId: string;
  const http = () => fake.http();

  async function customer(phone: string) {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }
  async function order(c: Session & { addressId: string }, method: 'online' | 'cod', quantity = 3) {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method }).expect(201)).body;
    if (method === 'online') await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    return { id: o.id as string, code: o.code as string, totalPaise: o.totalPaise as number };
  }
  async function onTheWay(orderId: string, r: Session = rider) {
    await http().post(`/v1/orders/${orderId}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    const offer = (await http().get('/v1/riders/me').set(r.headers).expect(200)).body.offer;
    const job = (await http().post(`/v1/offers/${offer.id}/accept`).set(r.headers).expect(200)).body;
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; pickupCode: string }>).find((x) => x.orderId === orderId)!;
    await http().post(`/v1/orders/${orderId}/ready`).set(owner.headers).expect(200);
    await http().post(`/v1/jobs/${job.id}/picked-up`).set(r.headers).send({ pickupCode: d.pickupCode }).expect(200);
    return job.id as string;
  }
  const commsLog = async (orderId: string) => (await http().get(`/v1/ops/orders/${orderId}`).set(ops).expect(200)).body.comms as Array<{ template: string; status: string }>;
  const deliver = (jobId: string, r: Session, body: Record<string, unknown>) => http().post(`/v1/jobs/${jobId}/delivered`).set(r.headers).send(body);

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    store = me.merchant.location;
    marketId = me.merchant.microMarketId ?? me.microMarket.id;
    items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items;
    ops = (await fake.opsSignIn()).headers;
    rider = await fake.signIn('9000000101', 'rider');
    other = await fake.signIn('9000000102', 'rider');
    await http().put('/v1/riders/me/status').set(rider.headers).send({ online: true, zones: [marketId] }).expect(200);
    await http().post('/v1/riders/me/location').set(rider.headers).send(north(store, 300)).expect(204);
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: arrived at the door → the customer is told; a prepaid order is delivered with a door photo the customer can see', async () => {
    const c = await customer('9876500951');
    const o = await order(c, 'online');
    const jobId = await onTheWay(o.id);
    const before = (await http().get(`/v1/jobs/${jobId}`).set(rider.headers).expect(200)).body;
    expect(before).toMatchObject({ arrivedDropAt: null, photoProofAllowed: true });

    // A photo before arriving is refused.
    const early = await fake.uploadRiderPhoto(rider, 'delivery', jobId);
    expect((await deliver(jobId, rider, { photoMediaId: early.id }).expect(409)).body.error.code).toBe('INVALID_STATE');

    const arrived = (await http().post(`/v1/jobs/${jobId}/arrived-drop`).set(rider.headers).expect(200)).body;
    expect(arrived.arrivedDropAt).toEqual(expect.any(String));
    await http().post(`/v1/jobs/${jobId}/arrived-drop`).set(rider.headers).expect(200); // idempotent
    expect((await commsLog(o.id)).filter((x) => x.template === 'customer.courier_arrived' && x.status === 'sent')).toHaveLength(1);
    expect((await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.arrivedDropAt).toBe(arrived.arrivedDropAt);

    // Made-up ids are refused; the real door photo works.
    expect((await deliver(jobId, rider, { photoMediaId: '6f1c2d3e-4a5b-4c6d-8e7f-001122334455' }).expect(400)).body.error.details.field).toBe('photoMediaId');
    await deliver(jobId, rider, { photoMediaId: early.id }).expect(200);
    expect((await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body.state).toBe('DELIVERED');

    const t = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body;
    expect(t.proofPhotoUrl).toMatch(/^\/v1\/dev\/private\?/);
    expect((await http().get(t.proofPhotoUrl).expect(200)).headers['content-type']).toBe('image/webp');

    // Ops see the same evidence in a dispute (ADR-033): how it was confirmed, the door times and the photo.
    const evidence = (await http().get(`/v1/ops/orders/${o.id}/delivery-proof`).set(ops).expect(200)).body;
    expect(evidence).toMatchObject({ orderId: o.id, state: 'delivered', proof: 'photo', arrivedDropAt: arrived.arrivedDropAt, failedAt: null });
    expect(evidence.deliveredAt).toEqual(expect.any(String));
    expect(evidence.waitedMinutes).toBeGreaterThanOrEqual(0);
    expect(evidence.photoUrl).toMatch(/^\/v1\/dev\/private\?/);
    expect((await http().get(evidence.photoUrl).expect(200)).headers['content-type']).toBe('image/webp');
    // Only ops roles: not the customer, the rider or the store, and not without a sign-in.
    await http().get(`/v1/ops/orders/${o.id}/delivery-proof`).expect(401);
    await http().get(`/v1/ops/orders/${o.id}/delivery-proof`).set(c.headers).expect(403);
    await http().get(`/v1/ops/orders/${o.id}/delivery-proof`).set(rider.headers).expect(403);
    await http().get(`/v1/ops/orders/${o.id}/delivery-proof`).set(owner.headers).expect(403);
  });

  it("another rider's photo, or a photo from another job, does not count", async () => {
    // The other rider's photo for their own job.
    await http().put('/v1/riders/me/status').set(other.headers).send({ online: true, zones: [marketId] }).expect(200);
    await http().post('/v1/riders/me/location').set(other.headers).send(north(store, 100)).expect(204);
    await http().put('/v1/riders/me/status').set(rider.headers).send({ online: false }).expect(200);
    const c1 = await customer('9876500952');
    const o1 = await order(c1, 'online');
    const theirJob = await onTheWay(o1.id, other);
    const theirs = await fake.uploadRiderPhoto(other, 'delivery', theirJob);
    // Someone else's job: no door photo for it.
    await http().post('/v1/riders/me/photos').set(rider.headers).send({ kind: 'delivery', contentType: 'image/png', fulfilmentId: theirJob }).expect(404);

    await http().put('/v1/riders/me/status').set(rider.headers).send({ online: true, zones: [marketId] }).expect(200);
    await http().post('/v1/riders/me/location').set(rider.headers).send(north(store, 50)).expect(204);
    const c2 = await customer('9876500953');
    const o2 = await order(c2, 'online');
    const myJob = await onTheWay(o2.id, rider);
    await http().post(`/v1/jobs/${myJob}/arrived-drop`).set(rider.headers).expect(200);
    expect((await deliver(myJob, rider, { photoMediaId: theirs.id }).expect(400)).body.error.details.field).toBe('photoMediaId');

    // The other rider's photo for a different job of theirs doesn't fit this job either.
    await http().post(`/v1/jobs/${theirJob}/arrived-drop`).set(other.headers).expect(200);
    const mine = await fake.uploadRiderPhoto(rider, 'delivery', myJob);
    await deliver(theirJob, other, { photoMediaId: mine.id }).expect(400);
    // Clean up: both delivered properly.
    await deliver(myJob, rider, { photoMediaId: mine.id }).expect(200);
    await deliver(theirJob, other, { photoMediaId: theirs.id }).expect(200);
    await http().put('/v1/riders/me/status').set(other.headers).send({ online: false }).expect(200);
  });

  it('cash orders always need the OTP', async () => {
    const c = await customer('9876500954');
    const o = await order(c, 'cod');
    const jobId = await onTheWay(o.id);
    expect((await http().get(`/v1/jobs/${jobId}`).set(rider.headers).expect(200)).body.photoProofAllowed).toBe(false);
    await http().post(`/v1/jobs/${jobId}/arrived-drop`).set(rider.headers).expect(200);
    const p = await fake.uploadRiderPhoto(rider, 'delivery', jobId);
    const refused = await deliver(jobId, rider, { photoMediaId: p.id, codCollectedPaise: o.totalPaise }).expect(400);
    expect(refused.body.error.details.field).toBe('otp');
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp;
    await deliver(jobId, rider, { otp, codCollectedPaise: o.totalPaise }).expect(200);
    const cash = (await http().get(`/v1/ops/orders/${o.id}/delivery-proof`).set(ops).expect(200)).body;
    expect(cash).toMatchObject({ proof: 'otp', photoUrl: null, codCollectedPaise: o.totalPaise });
    expect((await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.proofPhotoUrl).toBeNull();
  });

  it('sign-up photos are locked once approved; a door photo needs a job on the way', async () => {
    // The demo rider is approved: no new selfie.
    expect((await http().post('/v1/riders/me/photos').set(rider.headers).send({ kind: 'selfie', contentType: 'image/png' }).expect(409)).body.error.code).toBe('INVALID_STATE');
    await http().post('/v1/riders/me/photos').set(rider.headers).send({ kind: 'delivery', contentType: 'image/png' }).expect(404);
    await http().post('/v1/riders/me/photos').set(rider.headers).send({ kind: 'selfie', contentType: 'application/pdf' }).expect(400);
  });
});
