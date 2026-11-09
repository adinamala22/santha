/**
 * Tips, incentives and the rider cash limit (ADR-032), fake mode:
 *  - a tip at checkout is added to the total and goes 100% to the rider who delivers (a "tip" pay line);
 *  - ops set incentives per micro-market (versioned config); the rider sees progress; the payout adds the bonus;
 *  - ops set a cash limit (none by default); at the limit the rider gets prepaid orders only; a cash deposit
 *    recorded by ops lowers cash in hand and is credited in the payout (not deducted twice).
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
const key = () => `tip-key-${Date.now()}-${++seq}`;

describe('Tips, incentives and the cash limit (ADR-032, fake mode)', () => {
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
  async function order(c: Session & { addressId: string }, method: 'online' | 'cod', tipPaise?: number) {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 3 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method, ...(tipPaise ? { tipPaise } : {}) }).expect(201)).body;
    if (method === 'online') await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    return { id: o.id as string, code: o.code as string, totalPaise: o.totalPaise as number, tipPaise: o.tipPaise as number, billTotal: q.bill.totalPaise as number };
  }
  async function deliver(c: Session, o: { id: string }) {
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    const offer = (await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.offer;
    expect(offer, 'offer reaches the rider').not.toBeNull();
    const job = (await http().post(`/v1/offers/${offer.id}/accept`).set(rider.headers).expect(200)).body;
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; pickupCode: string }>).find((x) => x.orderId === o.id)!;
    await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(200);
    await http().post(`/v1/jobs/${job.id}/picked-up`).set(rider.headers).send({ pickupCode: d.pickupCode }).expect(200);
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp;
    return (await http().post(`/v1/jobs/${job.id}/delivered`).set(rider.headers).send({ otp, ...(job.codDuePaise ? { codCollectedPaise: job.codDuePaise } : {}) }).expect(200)).body;
  }
  const home = async () => (await http().get('/v1/riders/me').set(rider.headers).expect(200)).body;
  async function setRiderPay(patch: Record<string, unknown>) {
    const cur = (await http().get(`/v1/ops/micro-markets/${marketId}`).set(ops).expect(200)).body.current;
    const config = { polygon: cur.polygon, hours: cur.hours, fees: cur.fees, cod: cur.cod, sla: cur.sla, discovery: cur.discovery, riderPay: { ...cur.riderPay, ...patch } };
    await http().post(`/v1/ops/micro-markets/${marketId}/versions`).set(ops).send({ config, note: 'ADR-032 test' }).expect(201);
  }

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

  it('defaults: no cash limit and no incentives', async () => {
    expect(await home()).toMatchObject({ cashLimitPaise: null, incentives: [] });
  });

  it('ACCEPTANCE: a tip at checkout is added to the total and paid 100% to the rider', async () => {
    const c = await customer('9876500981');
    const o = await order(c, 'online', 2_000);
    expect(o.tipPaise).toBe(2_000);
    expect(o.totalPaise).toBe(o.billTotal + 2_000);
    await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: '6f1c2d3e-4a5b-4c6d-8e7f-001122334455', paymentMethod: 'online', tipPaise: 60_000 }).expect(400); // tip cap
    const job = await deliver(c, o);
    expect(job.payLines).toEqual(expect.arrayContaining([{ code: 'tip', amountPaise: 2_000 }]));
    expect(job.payPaise).toBe(job.payLines.reduce((s: number, l: { amountPaise: number }) => s + l.amountPaise, 0));
    const earnings = (await http().get('/v1/riders/me/earnings').set(rider.headers).expect(200)).body;
    expect(earnings.deliveries.at(-1).payLines.map((l: { code: string }) => l.code)).toContain('tip');
  });

  it('incentives: progress on the rider home; the payout adds the bonus', async () => {
    await setRiderPay({ incentives: [{ deliveries: 2, bonusPaise: 15_000, period: 'day' }, { deliveries: 50, bonusPaise: 100_000, period: 'week' }] });
    const before = (await home()).incentives;
    expect(before).toEqual([
      { period: 'day', deliveries: 2, bonusPaise: 15_000, done: 1, achieved: false },
      expect.objectContaining({ period: 'week', deliveries: 50, done: 1, achieved: false }),
    ]);
    const c = await customer('9876500982');
    await deliver(c, await order(c, 'online'));
    expect((await home()).incentives[0]).toMatchObject({ done: 2, achieved: true });

    // Riders are weekly by default: settle the week containing today (a run dated next week).
    const now = new Date((await http().get('/v1/dev/clock').expect(200)).body.now);
    const nextWeek = new Date(now.getTime() + 7 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const run = (await http().post('/v1/ops/settlements/run').set(ops).send({ kind: 'rider_weekly', date: nextWeek }).expect(201)).body;
    const p = ((await http().get(`/v1/ops/settlements/${run.id}/payouts`).set(ops).expect(200)).body.items as Array<{ partyName: string; netPaise: number; totals: Record<string, number> }>).find((x) => x.partyName === 'Demo Rider 1')!;
    expect(p.totals.incentivesPaise).toBe(15_000);
    expect(p.netPaise).toBe(p.totals.earnedPaise! + 15_000 - p.totals.cashHeldPaise! + p.totals.depositsPaise!);
  });

  it('cash limit: at the limit, cash orders skip the rider (prepaid still come); a deposit brings them back', async () => {
    const c = await customer('9876500983');
    const cod = await order(c, 'cod', 1_000);
    expect(cod.totalPaise).toBe(cod.billTotal + 1_000); // the cash tip is collected with the order
    await deliver(c, cod);
    const cash = (await home()).cashInHandPaise as number;
    expect(cash).toBeGreaterThanOrEqual(cod.totalPaise);

    await setRiderPay({ cashLimitPaise: cash });
    expect((await home()).cashLimitPaise).toBe(cash);
    const c2 = await customer('9876500984');
    const next = await order(c2, 'cod');
    await http().post(`/v1/orders/${next.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    expect((await home()).offer).toBeNull(); // over the limit: no cash orders
    const prepaid = await order(c2, 'online');
    await http().post(`/v1/orders/${prepaid.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    const offer = (await home()).offer;
    expect(offer).not.toBeNull(); // prepaid still comes
    await http().post(`/v1/offers/${offer.id}/decline`).set(rider.headers).expect(204);

    // The rider hands the cash to Santha; ops record it (audited). Cash orders come again.
    await http().post(`/v1/ops/riders/${rider.user.id}/cash-deposits`).set(rider.headers).send({ amountPaise: cash }).expect(403);
    const dep = (await http().post(`/v1/ops/riders/${rider.user.id}/cash-deposits`).set(ops).send({ amountPaise: cash, note: 'Handed over at the hub' }).expect(201)).body;
    expect(dep.cashInHandPaise).toBe(0);
    const audit = (await http().get(`/v1/ops/audit?entity=rider&entityId=${rider.user.id}`).set(ops).expect(200)).body.items as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain('rider.cash_deposit');
    const c3 = await customer('9876500985');
    const again = await order(c3, 'cod');
    await http().post(`/v1/orders/${again.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    expect((await home()).offer).not.toBeNull();
  });
});
