/**
 * Rider SOS (ADR-031) and the 7-day earnings summary, fake mode:
 *  - SOS alerts ops with the position (and the delivery in hand); pressing again returns the same alert;
 *  - it is first on the live board until ops resolve it (audited);
 *  - the week shows 7 IST days, oldest first, with deliveries, pay and COD cash per day.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / 111_195, lng: from.lng });
type StoreItem = { id: string; name: string; variants: Array<{ id: string }> };
type Attention = { kind: string; orderId: string | null; code: string | null; stage: string | null; sos: { id: string; riderName: string; lat: number | null; lng: number | null; called112: boolean } | null };

let seq = 0;
const key = () => `sos-key-${Date.now()}-${++seq}`;

describe('Rider SOS and 7-day earnings (ADR-031, fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let ops: Session['headers'];
  let rider: Session;
  let items: StoreItem[];
  let store: { lat: number; lng: number };
  let marketId: string;
  const http = () => fake.http();

  async function customer(phone: string) {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }
  async function codOrder(c: Session & { addressId: string }) {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 3 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'cod' }).expect(201)).body;
    return { id: o.id as string, code: o.code as string, totalPaise: o.totalPaise as number };
  }
  async function onTheWay(orderId: string) {
    await http().post(`/v1/orders/${orderId}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    const offer = (await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.offer;
    const job = (await http().post(`/v1/offers/${offer.id}/accept`).set(rider.headers).expect(200)).body;
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; pickupCode: string }>).find((x) => x.orderId === orderId)!;
    await http().post(`/v1/orders/${orderId}/ready`).set(owner.headers).expect(200);
    await http().post(`/v1/jobs/${job.id}/picked-up`).set(rider.headers).send({ pickupCode: d.pickupCode }).expect(200);
    return job.id as string;
  }
  async function deliverCod(c: Session, o: { id: string; totalPaise: number }, jobId: string) {
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp;
    await http().post(`/v1/jobs/${jobId}/delivered`).set(rider.headers).send({ otp, codCollectedPaise: o.totalPaise }).expect(200);
  }
  const board = async () => (await http().get('/v1/ops/live').set(ops).expect(200)).body.attention as Attention[];
  const audit = async (userId: string) => ((await http().get(`/v1/ops/audit?entity=rider&entityId=${userId}`).set(ops).expect(200)).body.items as Array<{ action: string; after: Record<string, unknown> }>);

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    store = me.merchant.location;
    marketId = me.merchant.microMarketId ?? me.microMarket.id;
    items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items;
    ops = (await fake.opsSignIn()).headers;
    rider = await fake.signIn('9000000101', 'rider');
    await http().put('/v1/riders/me/status').set(rider.headers).send({ online: true, zones: [marketId] }).expect(200);
    await http().post('/v1/riders/me/location').set(rider.headers).send(north(store, 300)).expect(204);
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: SOS reaches ops first on the live board with where the rider is; ops resolve it (audited)', async () => {
    const a = (await http().post('/v1/riders/me/sos').set(rider.headers).send({}).expect(200)).body;
    expect(a).toMatchObject({ id: expect.any(String), fulfilmentId: null });
    // Pressing again (a panicked double tap) does not raise a second alert.
    const again = (await http().post('/v1/riders/me/sos').set(rider.headers).send({ called112: true }).expect(200)).body;
    expect(again.id).toBe(a.id);

    const first = (await board())[0]!;
    expect(first).toMatchObject({ kind: 'rider_sos', orderId: null, sos: { id: a.id, riderName: 'Demo Rider 1', called112: false } });
    expect(first.sos!.lat).toBeCloseTo(north(store, 300).lat, 5); // the last known position
    expect((await audit(rider.user.id)).find((x) => x.action === 'rider.sos')?.after).toMatchObject({ sosId: a.id });

    // Riders and consumers cannot resolve it.
    await http().post(`/v1/ops/sos/${a.id}/resolve`).set(rider.headers).send({}).expect(403);
    await http().post(`/v1/ops/sos/${a.id}/resolve`).set(ops).send({ note: 'Called the rider: flat tyre, safe.' }).expect(200);
    expect((await board()).some((x) => x.kind === 'rider_sos')).toBe(false);
    expect((await http().post(`/v1/ops/sos/${a.id}/resolve`).set(ops).send({}).expect(409)).body.error.code).toBe('INVALID_STATE');
    expect((await audit(rider.user.id)).find((x) => x.action === 'rider.sos_resolved')?.after).toMatchObject({ note: 'Called the rider: flat tyre, safe.' });
  });

  it('SOS during a delivery names the order; the phone position is used when sent', async () => {
    const c = await customer('9876500971');
    const o = await codOrder(c);
    const jobId = await onTheWay(o.id);
    const here = north(store, 900);
    const a = (await http().post('/v1/riders/me/sos').set(rider.headers).send({ ...here, called112: true }).expect(200)).body;
    expect(a.fulfilmentId).toBe(jobId);
    const item = (await board()).find((x) => x.kind === 'rider_sos')!;
    expect(item).toMatchObject({ orderId: o.id, code: o.code, stage: 'called_112', sos: { lat: here.lat, lng: here.lng, called112: true } });
    await http().post(`/v1/ops/sos/${a.id}/resolve`).set(ops).send({}).expect(200);
    await deliverCod(c, o, jobId);
  });

  it('7-day earnings: one bucket per IST day, oldest first; yesterday and today add up', async () => {
    const before = (await http().get('/v1/riders/me/earnings/week').set(rider.headers).expect(200)).body;
    expect(before.days).toHaveLength(7);
    const todayBefore = before.days[6];

    // Another delivery today, then move the clock a day: it shows as yesterday.
    const c = await customer('9876500972');
    const o = await codOrder(c);
    await deliverCod(c, o, await onTheWay(o.id));
    const pay = (await http().get('/v1/riders/me/earnings').set(rider.headers).expect(200)).body.deliveries.at(-1).payPaise as number;
    const today = (await http().get('/v1/riders/me/earnings/week').set(rider.headers).expect(200)).body;
    expect(today.days[6]).toMatchObject({ deliveries: todayBefore.deliveries + 1, earnedPaise: todayBefore.earnedPaise + pay, cashPaise: todayBefore.cashPaise + o.totalPaise });

    await fake.advanceClock(24);
    const next = (await http().get('/v1/riders/me/earnings/week').set(rider.headers).expect(200)).body;
    expect(next.days[5]).toEqual(today.days[6]); // yesterday
    expect(next.days[6]).toMatchObject({ deliveries: 0, earnedPaise: 0 });
    const dates = next.days.map((d: { date: string }) => d.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(7);
    expect(next.totalPaise).toBe(next.days.reduce((s: number, d: { earnedPaise: number }) => s + d.earnedPaise, 0));
  });
});
