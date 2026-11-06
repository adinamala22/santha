/**
 * Couldn't deliver (ADR-026), fake mode:
 *  - a rider on the way reports why (no answer, wrong address, …); the order becomes FAILED_DELIVERY, the
 *    customer and the store are told, and ops see it under "needs attention";
 *  - the courier tries again when the customer calls back (back to OUT_FOR_DELIVERY, then delivered);
 *  - ops retry it, or cancel it with or without a refund (audited);
 *  - store staff (the /d/ link) can report it too; only an order on its way can fail.
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
const key = () => `fd-key-${Date.now()}-${++seq}`;

describe("Couldn't deliver (ADR-026, fake mode)", () => {
  let fake: FakeApp;
  let owner: Session;
  let ops: Session['headers'];
  let rider: Session;
  let items: StoreItem[];
  let store: { lat: number; lng: number };
  let marketId: string;
  let staffId: string;
  const http = () => fake.http();

  async function customer(phone: string) {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }
  async function order(c: Session & { addressId: string }, method: 'online' | 'cod') {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 3 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method }).expect(201)).body;
    if (method === 'online') await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    return { id: o.id as string, code: o.code as string, totalPaise: o.totalPaise as number };
  }
  /** A rider order picked up and on its way; returns the job id. */
  async function onTheWay(orderId: string) {
    await http().post(`/v1/orders/${orderId}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    const offer = (await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.offer;
    const job = (await http().post(`/v1/offers/${offer.id}/accept`).set(rider.headers).expect(200)).body;
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; pickupCode: string }>).find((x) => x.orderId === orderId)!;
    await http().post(`/v1/orders/${orderId}/ready`).set(owner.headers).expect(200);
    await http().post(`/v1/jobs/${job.id}/picked-up`).set(rider.headers).send({ pickupCode: d.pickupCode }).expect(200);
    return job.id as string;
  }
  const state = async (c: Session, orderId: string) => (await http().get(`/v1/orders/${orderId}`).set(c.headers).expect(200)).body;
  const comms = async (orderId: string) => ((await http().get(`/v1/ops/orders/${orderId}`).set(ops).expect(200)).body.comms as Array<{ template: string }>).map((x) => x.template);
  const audit = async (orderId: string) => ((await http().get(`/v1/ops/audit?entity=order&entityId=${orderId}`).set(ops).expect(200)).body.items as Array<{ action: string; after: Record<string, unknown> }>);
  const wallet = async (c: Session) => (await http().get('/v1/wallet').set(c.headers).expect(200)).body.balancePaise as number;

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    store = me.merchant.location;
    marketId = me.merchant.microMarketId ?? me.microMarket.id;
    staffId = me.staff.find((s: { name: string }) => s.name === 'Suresh').id;
    items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items;
    ops = (await fake.opsSignIn()).headers;
    rider = await fake.signIn('9000000101', 'rider');
    await http().put('/v1/riders/me/status').set(rider.headers).send({ online: true, zones: [marketId] }).expect(200);
    await http().post('/v1/riders/me/location').set(rider.headers).send(north(store, 300)).expect(204);
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: the rider reports no answer; everyone is told; the customer calls back and the rider delivers', async () => {
    const c = await customer('9876500901');
    const o = await order(c, 'cod');
    const jobId = await onTheWay(o.id);

    const failed = (await http().post(`/v1/jobs/${jobId}/failed`).set(rider.headers).send({ reason: 'no_answer', note: 'Called twice, gate locked' }).expect(200)).body;
    expect(failed).toMatchObject({ state: 'failed', failedReason: 'no_answer' });
    expect(await state(c, o.id)).toMatchObject({ state: 'FAILED_DELIVERY', outcomeReason: 'delivery_failed_no_answer' });
    expect(await comms(o.id)).toEqual(expect.arrayContaining(['customer.delivery_failed', 'merchant.delivery_failed']));
    expect((await audit(o.id)).find((a) => a.action === 'dispatch.delivery_failed')?.after).toMatchObject({ reason: 'no_answer', note: 'Called twice, gate locked', by: 'rider' });

    // Still the rider's job (they hold the goods) and on the ops board.
    expect(((await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.jobs as Array<{ id: string }>).map((j) => j.id)).toContain(jobId);
    const live = (await http().get('/v1/ops/live').set(ops).expect(200)).body;
    expect(live.attention).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'delivery_failed', orderId: o.id, stage: 'no_answer' })]));

    // Reported once only.
    expect((await http().post(`/v1/jobs/${jobId}/failed`).set(rider.headers).send({ reason: 'other' }).expect(409)).body.error.code).toBe('INVALID_STATE');

    await http().post(`/v1/jobs/${jobId}/retry`).set(rider.headers).expect(200);
    expect(await state(c, o.id)).toMatchObject({ state: 'OUT_FOR_DELIVERY', outcomeReason: null });
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp;
    await http().post(`/v1/jobs/${jobId}/delivered`).set(rider.headers).send({ otp, codCollectedPaise: o.totalPaise }).expect(200);
    expect((await state(c, o.id)).state).toBe('DELIVERED');
  });

  it('ops cancel a failed delivery with a refund (wallet), or without; both audited', async () => {
    const c = await customer('9876500902');
    const o = await order(c, 'online');
    const jobId = await onTheWay(o.id);
    await http().post(`/v1/jobs/${jobId}/failed`).set(rider.headers).send({ reason: 'wrong_address' }).expect(200);
    const before = await wallet(c);
    await http().post(`/v1/ops/orders/${o.id}/cancel-failed-delivery`).set(ops).send({ refund: true, reason: 'Pin was dropped in the wrong area' }).expect(200);
    expect(await state(c, o.id)).toMatchObject({ state: 'CANCELLED', refundedPaise: o.totalPaise });
    expect(await wallet(c)).toBe(before + o.totalPaise);
    expect((await audit(o.id)).find((a) => a.action === 'dispatch.failed_delivery_cancelled')?.after).toMatchObject({ refund: true });
    // The job leaves the rider's list.
    expect(((await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.jobs as Array<{ id: string }>).map((j) => j.id)).not.toContain(jobId);

    const c2 = await customer('9876500903');
    const o2 = await order(c2, 'online');
    const job2 = await onTheWay(o2.id);
    await http().post(`/v1/jobs/${job2}/failed`).set(rider.headers).send({ reason: 'customer_refused' }).expect(200);
    const before2 = await wallet(c2);
    await http().post(`/v1/ops/orders/${o2.id}/cancel-failed-delivery`).set(ops).send({ refund: false, reason: 'Refused at the door' }).expect(200);
    expect(await state(c2, o2.id)).toMatchObject({ state: 'CANCELLED', refundedPaise: 0 });
    expect(await wallet(c2)).toBe(before2);
  });

  it('ops send a failed delivery out again (audited); store staff can report one too', async () => {
    const c = await customer('9876500904');
    const o = await order(c, 'cod');
    const jobId = await onTheWay(o.id);
    await http().post(`/v1/jobs/${jobId}/failed`).set(rider.headers).send({ reason: 'unsafe' }).expect(200);
    const d = (await http().post(`/v1/ops/orders/${o.id}/retry-delivery`).set(ops).expect(200)).body;
    expect(d).toMatchObject({ fulfilmentState: 'picked_up', orderState: 'OUT_FOR_DELIVERY' });
    expect((await state(c, o.id)).state).toBe('OUT_FOR_DELIVERY');
    expect((await audit(o.id)).map((a) => a.action)).toContain('dispatch.delivery_retried');
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp;
    await http().post(`/v1/jobs/${jobId}/delivered`).set(rider.headers).send({ otp, codCollectedPaise: o.totalPaise }).expect(200); // frees the rider

    // Staff link: self delivery by Suresh.
    const c2 = await customer('9876500905');
    const o2 = await order(c2, 'cod');
    await http().post(`/v1/orders/${o2.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'self', staffId }).expect(200);
    const link = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; staffLink: string }>).find((x) => x.orderId === o2.id)!.staffLink;
    const token = link.split('/d/')[1]!;
    // Not yet on the way: refused.
    expect((await http().post(`/v1/staff-jobs/${token}/failed`).send({ reason: 'no_answer' }).expect(409)).body.error.code).toBe('INVALID_STATE');
    await http().post(`/v1/orders/${o2.id}/ready`).set(owner.headers).expect(200);
    await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(200);
    await http().post(`/v1/staff-jobs/${token}/failed`).send({ reason: 'no_answer' }).expect(200);
    expect((await state(c2, o2.id)).state).toBe('FAILED_DELIVERY');
    await http().post(`/v1/staff-jobs/${token}/retry`).expect(200);
    expect((await state(c2, o2.id)).state).toBe('OUT_FOR_DELIVERY');
  });

  it('roles: only ops cancel or retry; reasons are checked', async () => {
    const c = await customer('9876500906');
    const o = await order(c, 'cod');
    const jobId = await onTheWay(o.id);
    await http().post(`/v1/jobs/${jobId}/failed`).set(rider.headers).send({ reason: 'lost' }).expect(400);
    await http().post(`/v1/jobs/${jobId}/failed`).set(rider.headers).send({ reason: 'other' }).expect(200);
    await http().post(`/v1/ops/orders/${o.id}/cancel-failed-delivery`).set(owner.headers).send({ refund: true, reason: 'nope' }).expect(403);
    await http().post(`/v1/ops/orders/${o.id}/retry-delivery`).set(c.headers).expect(403);
    await http().post(`/v1/ops/orders/${o.id}/cancel-failed-delivery`).set(ops).send({ refund: true, reason: '' }).expect(400);
  });
});
