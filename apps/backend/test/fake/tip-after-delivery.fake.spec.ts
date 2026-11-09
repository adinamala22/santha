/**
 * Tip after delivery (ADR-037), fake mode:
 *  - a delivered order can be tipped within 24 hours: its own payment (mock sheet), 100% to the rider;
 *  - the rider is told, and the next payout adds the tip;
 *  - only the customer of an order delivered by a Santha rider, once paid, within the window, within the amounts;
 *  - the payment is confirmed with a verified signature, only by whoever started it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { MessagingProvider, type SentMessage } from '../../src/infra/providers/messaging/messaging.provider';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / 111_195, lng: from.lng });
type StoreItem = { id: string; name: string; variants: Array<{ id: string }> };

let seq = 0;
const key = () => `ptip-key-${Date.now()}-${++seq}`;

describe('Tip after delivery (ADR-037, fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let ops: Session['headers'];
  let rider: Session;
  let items: StoreItem[];
  let store: { lat: number; lng: number };
  let marketId: string;
  let sent: SentMessage[];
  const http = () => fake.http();

  async function customer(phone: string) {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }
  async function place(c: Session & { addressId: string }) {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 3 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'online' }).expect(201)).body;
    await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    return { id: o.id as string, code: o.code as string };
  }
  /** Delivered by the Santha rider with the OTP. */
  async function delivered(c: Session & { addressId: string }) {
    const o = await place(c);
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    const offer = (await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.offer;
    const job = (await http().post(`/v1/offers/${offer.id}/accept`).set(rider.headers).expect(200)).body;
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; pickupCode: string }>).find((x) => x.orderId === o.id)!;
    await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(200);
    await http().post(`/v1/jobs/${job.id}/picked-up`).set(rider.headers).send({ pickupCode: d.pickupCode }).expect(200);
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp;
    await http().post(`/v1/jobs/${job.id}/delivered`).set(rider.headers).send({ otp }).expect(200);
    return o;
  }
  const offer = async (c: Session, orderId: string) => (await http().get(`/v1/orders/${orderId}/tip`).set(c.headers).expect(200)).body;

  beforeAll(async () => {
    fake = await bootFakeApp();
    sent = (fake.app.get(MessagingProvider) as unknown as { sent: SentMessage[] }).sent;
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

  it('ACCEPTANCE: tip a delivered order; it is its own payment; the rider is told; the payout adds it', async () => {
    const c = await customer('9876501201');
    const o = await delivered(c);
    const before = await offer(c, o.id);
    expect(before).toMatchObject({ canTip: true, reason: 'ok', tippedPaise: 0, minPaise: 1000, maxPaise: 20_000, choicesPaise: [1000, 2000, 3000, 5000, 10_000] });
    expect(Date.parse(before.until) - Date.now()).toBeGreaterThan(23 * 3_600_000);

    const pay = (await http().post(`/v1/orders/${o.id}/tip`).set(c.headers).send({ amountPaise: 2000 }).expect(200)).body;
    expect(pay).toMatchObject({ provider: 'mock', amountPaise: 2000, status: 'created' });
    // The same amount again resumes the unpaid tip: no second payment is opened.
    expect((await http().post(`/v1/orders/${o.id}/tip`).set(c.headers).send({ amountPaise: 2000 }).expect(200)).body.intentId).toBe(pay.intentId);

    // A failed attempt leaves it open; then the payment goes through.
    expect((await http().post(`/v1/dev/tips/${pay.intentId}/fail`).expect(200)).body).toMatchObject({ status: 'created' });
    expect((await http().post(`/v1/dev/tips/${pay.intentId}/succeed`).expect(200)).body).toMatchObject({ status: 'captured' });

    expect(await offer(c, o.id)).toMatchObject({ canTip: false, reason: 'already_tipped', tippedPaise: 2000 });
    const again = await http().post(`/v1/orders/${o.id}/tip`).set(c.headers).send({ amountPaise: 1000 }).expect(409);
    expect(again.body.error).toMatchObject({ code: 'TIP_NOT_ALLOWED', details: { reason: 'already_tipped' } });

    // The rider is told (SMS in fake mode: the demo rider has no push token).
    await vi.waitFor(() => expect(sent.some((m) => m.template === 'rider.tip' && m.text.includes(o.code) && m.text.includes('20'))).toBe(true), { timeout: 5000 });

    // The week's payout adds the tip in full, on top of the delivery pay.
    const now = new Date((await http().get('/v1/dev/clock').expect(200)).body.now);
    const nextWeek = new Date(now.getTime() + 7 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const run = (await http().post('/v1/ops/settlements/run').set(ops).send({ kind: 'rider_weekly', date: nextWeek }).expect(201)).body;
    const p = ((await http().get(`/v1/ops/settlements/${run.id}/payouts`).set(ops).expect(200)).body.items as Array<{ partyName: string; netPaise: number; totals: Record<string, number> }>).find((x) => x.partyName === 'Demo Rider 1')!;
    expect(p.totals.lateTipsPaise).toBe(2000);
    expect(p.netPaise).toBe(p.totals.earnedPaise! + p.totals.incentivesPaise! + 2000 - p.totals.cashHeldPaise! + p.totals.depositsPaise!);
  });

  it('only the order customer, only when delivered, only within the amounts', async () => {
    const c = await customer('9876501202');
    const other = await customer('9876501203');
    const o = await place(c); // paid but not delivered yet
    expect(await offer(c, o.id)).toMatchObject({ canTip: false, reason: 'not_delivered' });
    expect((await http().post(`/v1/orders/${o.id}/tip`).set(c.headers).send({ amountPaise: 2000 }).expect(409)).body.error.details.reason).toBe('not_delivered');
    await http().get(`/v1/orders/${o.id}/tip`).set(other.headers).expect(404); // not their order
    await http().post(`/v1/orders/${o.id}/tip`).set(other.headers).send({ amountPaise: 2000 }).expect(404);
    await http().get(`/v1/orders/${o.id}/tip`).expect(401);

    // Cancel it so the rider stays free for the next scenario.
    await http().post(`/v1/orders/${o.id}/cancel`).set(c.headers).send({ reason: 'changed_mind' }).expect(200);

    const d = await customer('9876501204');
    const done = await delivered(d);
    for (const amountPaise of [0, 500, 999, 20_001, 99_999]) await http().post(`/v1/orders/${done.id}/tip`).set(d.headers).send({ amountPaise }).expect(400);
    await http().post(`/v1/orders/${done.id}/tip`).set(d.headers).send({ amountPaise: 12.5 }).expect(400);
    await http().post(`/v1/orders/${done.id}/tip`).set(d.headers).send({ amountPaise: 20_000 }).expect(200); // the top amount is fine
  });

  it('a payment is confirmed only with a valid signature, and only by whoever started it', async () => {
    const c = await customer('9876501206');
    const stranger = await customer('9876501207');
    const o = await delivered(c);
    const pay = (await http().post(`/v1/orders/${o.id}/tip`).set(c.headers).send({ amountPaise: 3000 }).expect(200)).body;
    const body = { providerOrderId: pay.providerOrderId, providerPaymentId: 'pay_fake_1', signature: 'not-a-real-signature' };
    expect((await http().post(`/v1/tips/${pay.intentId}/confirm`).set(c.headers).set('Idempotency-Key', key()).send(body).expect(400)).body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    await http().post(`/v1/tips/${pay.intentId}/confirm`).set(stranger.headers).set('Idempotency-Key', key()).send(body).expect(404);
    expect(await offer(c, o.id)).toMatchObject({ canTip: true, tippedPaise: 0 }); // nothing was captured
  });

  it('the window closes 24 hours after the delivery', async () => {
    const c = await customer('9876501205');
    const o = await delivered(c);
    expect((await offer(c, o.id)).canTip).toBe(true);
    await fake.advanceClock(25);
    const late = await offer(c, o.id);
    expect(late).toMatchObject({ canTip: false, reason: 'window_closed' });
    expect((await http().post(`/v1/orders/${o.id}/tip`).set(c.headers).send({ amountPaise: 2000 }).expect(409)).body.error.details.reason).toBe('window_closed');
  });
});
