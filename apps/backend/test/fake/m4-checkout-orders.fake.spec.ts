/**
 * M4 acceptance (fake mode): cart, pricing, promos, COD rules, POST /orders with Idempotency-Key,
 * online payment through the mock Razorpay (signed confirm + webhooks), payment expiry, wallet.
 *
 * BUILD-PLAN M4 acceptance:
 *  - place a paid test order (sandbox → here the signed mock) and see PLACED with the correct bill
 *  - duplicate POST with the same Idempotency-Key returns the same order
 *  - COD blocked for cooked food
 *  - promo budget exhaustion disables the code (immediately, well within 1 min)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_ADDRESSES, SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { hmacHex, MOCK_KEY_SECRET, MOCK_WEBHOOK_SECRET } from '../../src/infra/providers/payments/payments.provider';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const kitchen = SEED_MERCHANTS.find((m) => m.name === "Saraswathi's Kitchen")!;
const home = SEED_ADDRESSES.find((a) => a.ownerPhone === '+919000000001' && a.label === 'home')!;
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;

type StoreItem = { id: string; name: string; variants: Array<{ id: string; label: string; pricePaise: number }>; onMenuToday: boolean };
type Line = { itemId: string; variantId: string; quantity: number; substitution?: string };

let seq = 0;
const key = () => `test-key-${Date.now()}-${++seq}`;

describe('M4 · cart, pricing, payments, order placement (fake mode)', () => {
  let fake: FakeApp;
  let consumer: Session;
  let kiranaItems: StoreItem[];
  let kitchenItems: StoreItem[];
  const http = () => fake.http();

  const store = async (id: string) => (await http().get(`/v1/stores/${id}?lat=${dargamitta.lat}&lng=${dargamitta.lng}`).expect(200)).body;
  const item = (items: StoreItem[], name: string) => items.find((i) => i.name.startsWith(name))!;
  const line = (items: StoreItem[], name: string, quantity: number, label?: string): Line => {
    const i = item(items, name);
    const v = label ? i.variants.find((x) => x.label === label)! : i.variants[0]!;
    return { itemId: i.id, variantId: v.id, quantity };
  };
  const putCart = (s: Session, merchantId: string, lines: Line[], replace = true) => http().put('/v1/cart').set(s.headers).send({ merchantId, lines, replace });
  const price = (s: Session, body: Record<string, unknown>) => http().post('/v1/cart/price').set(s.headers).send({ addressId: home.id, when: { mode: 'asap' }, ...body });
  const place = (s: Session, quoteId: string, paymentMethod: 'online' | 'cod', k = key()) =>
    http().post('/v1/orders').set(s.headers).set('Idempotency-Key', k).send({ quoteId, paymentMethod });
  /** The two-kirana-items cart over ₹199 (free delivery): Atta 1 kg × 2 + Basmati. */
  const bigCart = () => [line(kiranaItems, 'Annapoorna Chakki Atta', 2, '1 kg'), line(kiranaItems, 'Annapoorna Basmati Rice', 1)];
  const confirmBody = (providerOrderId: string, paymentId: string) => ({ providerOrderId, providerPaymentId: paymentId, signature: hmacHex(MOCK_KEY_SECRET, `${providerOrderId}|${paymentId}`) });

  beforeAll(async () => {
    fake = await bootFakeApp();
    consumer = await fake.signIn(fake.seeded('consumer').phone, 'consumer');
    // Keep the kirana open around the clock so ASAP checkout does not depend on when CI runs.
    const owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200);
    kiranaItems = (await store(kirana.id)).items;
    kitchenItems = (await store(kitchen.id)).items;
  }, 60_000);
  afterAll(() => fake?.close());

  // ───────────── cart ─────────────

  it('cart holds one store: another store needs replace (CART_CONFLICT), empty lines clear it', async () => {
    const s = await fake.signIn('9876500401', 'consumer');
    await putCart(s, kirana.id, [line(kiranaItems, 'Annapoorna Chakki Atta', 1)], false).expect(200);
    const conflict = await putCart(s, kitchen.id, [line(kitchenItems, 'Veg Meals', 1)], false).expect(409);
    expect(conflict.body.error).toMatchObject({ code: 'CART_CONFLICT', details: { merchantId: kirana.id, merchantName: 'Ramesh Stores' } });
    const replaced = await putCart(s, kitchen.id, [line(kitchenItems, 'Veg Meals', 2)]).expect(200);
    expect(replaced.body).toMatchObject({ merchant: { id: kitchen.id }, itemCount: 2 });
    await http().put('/v1/cart').set(s.headers).send({ merchantId: kitchen.id, lines: [] }).expect(200);
    expect((await http().get('/v1/cart').set(s.headers).expect(200)).body).toMatchObject({ merchant: null, lines: [] });
    // Items must belong to the store
    await putCart(s, kirana.id, [line(kitchenItems, 'Veg Meals', 1)]).expect(400);
  });

  // ───────────── bill ─────────────

  it('bill: items GST-inclusive, free delivery over ₹199, platform fee + 18% GST on fees, total recomputed', async () => {
    await putCart(consumer, kirana.id, bigCart()).expect(200);
    const q = (await price(consumer, {}).expect(200)).body;
    const items = 2 * item(kiranaItems, 'Annapoorna Chakki Atta').variants.find((v) => v.label === '1 kg')!.pricePaise + item(kiranaItems, 'Annapoorna Basmati Rice').variants[0]!.pricePaise;
    expect(q.bill.itemsPaise).toBe(items);
    expect(q.bill.fees).toEqual([
      { code: 'delivery', amountPaise: 0, waivedPaise: expect.any(Number) },
      { code: 'platform', amountPaise: 500, waivedPaise: 0 },
    ]);
    expect(q.bill.taxes).toEqual([{ code: 'gst_fees', ratePercent: 18, basePaise: 500, amountPaise: 90 }]);
    expect(q.bill.totalPaise).toBe(items + 500 + 90);
    expect(q).toMatchObject({ placeable: true, problems: [], payment: { online: true, cod: { available: true } }, merchant: { id: kirana.id } });
  });

  it('below the store minimum the order cannot be placed (MIN_ORDER_NOT_MET)', async () => {
    const s = await fake.signIn('9876500402', 'consumer');
    await putCart(s, kirana.id, [line(kiranaItems, 'Annapoorna Chakki Atta', 1, '1 kg')]).expect(200);
    await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: '7, Dargamitta Main Road', location: dargamitta }).expect(201);
    const addressId = (await http().get('/v1/me/addresses').set(s.headers)).body.items[0].id;
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId, when: { mode: 'asap' } }).expect(200)).body;
    expect(q.placeable).toBe(false);
    expect(q.problems).toEqual([{ code: 'MIN_ORDER_NOT_MET', value: kirana.movPaise - 6000 }]);
    expect(q.bill.fees.map((f: { code: string }) => f.code)).toEqual(['delivery', 'small_order', 'platform']);
    await place(s, q.quoteId, 'cod').expect(422);
  });

  // ───────────── paid order ─────────────

  it('ACCEPTANCE: a paid order (signed mock Razorpay) is PLACED with the correct bill, and the cart empties', async () => {
    await putCart(consumer, kirana.id, bigCart()).expect(200);
    const q = (await price(consumer, {}).expect(200)).body;
    const created = await place(consumer, q.quoteId, 'online').expect(201);
    expect(created.body).toMatchObject({ state: 'AWAITING_PAYMENT', totalPaise: q.bill.totalPaise, paymentMethod: 'online', payment: { provider: 'mock', status: 'created', amountPaise: q.bill.totalPaise } });
    expect(created.body.paymentDueAt).toBeTruthy();
    const { intentId, providerOrderId } = created.body.payment;

    // A forged signature is refused
    await http().post(`/v1/payments/${intentId}/confirm`).set(consumer.headers).set('Idempotency-Key', key()).send({ providerOrderId, providerPaymentId: 'pay_x', signature: 'bad' }).expect(400);

    const paid = await http().post(`/v1/payments/${intentId}/confirm`).set(consumer.headers).set('Idempotency-Key', key()).send(confirmBody(providerOrderId, 'pay_ok_1')).expect(200);
    expect(paid.body.status).toBe('captured');

    const o = (await http().get(`/v1/orders/${created.body.id}`).set(consumer.headers).expect(200)).body;
    expect(o).toMatchObject({ state: 'PLACED', itemsPaise: q.bill.itemsPaise, feesPaise: 500, taxPaise: 90, discountPaise: 0, totalPaise: q.bill.totalPaise });
    expect(o.placedAt).toBeTruthy();
    expect(o.history.map((h: { to: string }) => h.to)).toEqual(['AWAITING_PAYMENT', 'PLACED']);
    expect(o.lines).toHaveLength(2);
    expect((await http().get('/v1/cart').set(consumer.headers)).body.lines).toEqual([]);
    expect((await http().get('/v1/orders').set(consumer.headers)).body.items[0].id).toBe(o.id);
  });

  it('ACCEPTANCE: duplicate POST /orders with the same Idempotency-Key returns the same order', async () => {
    await putCart(consumer, kirana.id, bigCart()).expect(200);
    const q = (await price(consumer, {}).expect(200)).body;
    const k = key();
    const first = await place(consumer, q.quoteId, 'cod', k).expect(201);
    const again = await place(consumer, q.quoteId, 'cod', k).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(first.body.state).toBe('PLACED'); // COD is placed at once
    // Same key, different body → 422; no key → 400
    await http().post('/v1/orders').set(consumer.headers).set('Idempotency-Key', k).send({ quoteId: q.quoteId, paymentMethod: 'online' }).expect(422);
    await http().post('/v1/orders').set(consumer.headers).send({ quoteId: q.quoteId, paymentMethod: 'cod' }).expect(400);
  });

  // ───────────── COD ─────────────

  it('ACCEPTANCE: COD is blocked for cooked food (home kitchens)', async () => {
    const s = await fake.signIn('9876500403', 'consumer');
    await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: '9, Dargamitta 3rd Lane', location: dargamitta }).expect(201);
    const addressId = (await http().get('/v1/me/addresses').set(s.headers)).body.items[0].id;
    await putCart(s, kitchen.id, [line(kitchenItems, 'Veg Meals', 2)]).expect(200);
    const slots = (await store(kitchen.id)).slots.occurrences.filter((o: { state: string }) => o.state === 'open');
    const slot = slots[slots.length - 1];
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId, when: { mode: 'slot', slotId: slot.slotId, date: slot.date } }).expect(200)).body;
    expect(q.payment.cod).toMatchObject({ available: false, reason: 'cooked_food' });
    expect(q.bill.taxes.map((t: { code: string }) => t.code)).toContain('gst_food'); // 5% on cooked food
    expect(q.when).toMatchObject({ mode: 'slot', slotId: slot.slotId, date: slot.date });
    const res = await place(s, q.quoteId, 'cod').expect(422);
    expect(res.body.error).toMatchObject({ code: 'COD_NOT_ALLOWED', details: { reason: 'cooked_food' } });
    // ASAP is not how kitchens sell
    const asap = (await http().post('/v1/cart/price').set(s.headers).send({ addressId, when: { mode: 'asap' } }).expect(200)).body;
    expect(asap.problems).toEqual(expect.arrayContaining([{ code: 'SLOT_REQUIRED' }]));
  });

  it('COD trust: at most two open COD orders per customer; over the market cap is refused', async () => {
    const s = await fake.signIn('9876500404', 'consumer');
    await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: '3, Dargamitta Cross Road', location: dargamitta }).expect(201);
    const addressId = (await http().get('/v1/me/addresses').set(s.headers)).body.items[0].id;
    for (let i = 0; i < 2; i++) {
      await putCart(s, kirana.id, bigCart()).expect(200);
      const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId, when: { mode: 'asap' } }).expect(200)).body;
      await place(s, q.quoteId, 'cod').expect(201);
    }
    await putCart(s, kirana.id, bigCart()).expect(200);
    const third = (await http().post('/v1/cart/price').set(s.headers).send({ addressId, when: { mode: 'asap' } }).expect(200)).body;
    expect(third.payment.cod).toMatchObject({ available: false, reason: 'too_many_open' });

    const big = await fake.signIn('9876500405', 'consumer');
    await http().post('/v1/me/addresses').set(big.headers).send({ label: 'home', line: '5, Dargamitta Cross Road', location: dargamitta }).expect(201);
    const bigAddress = (await http().get('/v1/me/addresses').set(big.headers)).body.items[0].id;
    await putCart(big, kirana.id, [line(kiranaItems, 'Annapoorna Basmati Rice', 10)]).expect(200);
    const q = (await http().post('/v1/cart/price').set(big.headers).send({ addressId: bigAddress, when: { mode: 'asap' } }).expect(200)).body;
    expect(q.bill.totalPaise).toBeGreaterThan(150000);
    expect(q.payment.cod).toMatchObject({ available: false, reason: 'over_limit', maxOrderPaise: 150000 });
  });

  // ───────────── promos ─────────────

  it('ACCEPTANCE: promo budget exhaustion disables the code immediately; a failed payment gives the budget back', async () => {
    // TINY: ₹60 off, ₹100 budget → one redemption fits, a second does not.
    const a = await fake.signIn('9876500406', 'consumer');
    await http().post('/v1/me/addresses').set(a.headers).send({ label: 'home', line: '6, Dargamitta Cross Road', location: dargamitta }).expect(201);
    const aAddress = (await http().get('/v1/me/addresses').set(a.headers)).body.items[0].id;
    await putCart(a, kirana.id, bigCart()).expect(200);
    const qa = (await http().post('/v1/cart/price').set(a.headers).send({ addressId: aAddress, when: { mode: 'asap' }, promoCode: 'tiny' }).expect(200)).body;
    expect(qa.promo).toMatchObject({ code: 'TINY', applied: true, discountPaise: 6000 });
    expect(qa.bill.discountPaise).toBe(6000);
    expect(qa.bill.totalPaise).toBe(qa.bill.itemsPaise + qa.bill.feesPaise + qa.bill.taxPaise - 6000);
    const orderA = await place(a, qa.quoteId, 'online').expect(201);
    expect(orderA.body).toMatchObject({ discountPaise: 6000, promoCode: 'TINY' });

    const b = await fake.signIn('9876500407', 'consumer');
    await http().post('/v1/me/addresses').set(b.headers).send({ label: 'home', line: '8, Dargamitta Cross Road', location: dargamitta }).expect(201);
    const bAddress = (await http().get('/v1/me/addresses').set(b.headers)).body.items[0].id;
    await putCart(b, kirana.id, bigCart()).expect(200);
    const qb = (await http().post('/v1/cart/price').set(b.headers).send({ addressId: bAddress, when: { mode: 'asap' }, promoCode: 'TINY' }).expect(200)).body;
    expect(qb.promo).toMatchObject({ applied: false, reason: 'budget_exhausted' });
    expect(qb.bill.discountPaise).toBe(0);

    // A abandons the payment → the reservation is released → the code works again for B.
    await http().post(`/v1/orders/${orderA.body.id}/abandon-payment`).set(a.headers).expect(200);
    const qb2 = (await http().post('/v1/cart/price').set(b.headers).send({ addressId: bAddress, when: { mode: 'asap' }, promoCode: 'TINY' }).expect(200)).body;
    expect(qb2.promo).toMatchObject({ applied: true, discountPaise: 6000 });

    // Ops see the budget
    const ops = await fake.opsSignIn();
    const tiny = (await http().get('/v1/ops/promos').set(ops.headers).expect(200)).body.items.find((p: { code: string }) => p.code === 'TINY');
    expect(tiny).toMatchObject({ spentPaise: 0, remainingPaise: 10000, status: 'active' });
  });

  it('promo rules: unknown code, minimum order, first-order-only', async () => {
    await putCart(consumer, kirana.id, [line(kiranaItems, 'Annapoorna Chakki Atta', 1, '1 kg'), line(kiranaItems, 'Annapoorna Basmati Rice', 1)]).expect(200);
    expect((await price(consumer, { promoCode: 'NOPE' }).expect(200)).body.promo).toMatchObject({ applied: false, reason: 'not_found' });
    // consumer already has placed orders above → NELLORE50 (first order only) is refused
    expect((await price(consumer, { promoCode: 'NELLORE50' }).expect(200)).body.promo).toMatchObject({ applied: false, reason: 'first_order_only' });
    const fresh = await fake.signIn('9876500408', 'consumer');
    await http().post('/v1/me/addresses').set(fresh.headers).send({ label: 'home', line: '10, Dargamitta Cross Road', location: dargamitta }).expect(201);
    const addressId = (await http().get('/v1/me/addresses').set(fresh.headers)).body.items[0].id;
    await putCart(fresh, kirana.id, [line(kiranaItems, 'Annapoorna Chakki Atta', 2, '1 kg')]).expect(200);
    const low = (await http().post('/v1/cart/price').set(fresh.headers).send({ addressId, when: { mode: 'asap' }, promoCode: 'NELLORE50' }).expect(200)).body;
    expect(low.promo).toMatchObject({ applied: false, reason: 'min_order', minOrderPaise: 19900 });
  });

  it('ops create, pause and resume promos with audit; a paused code stops applying', async () => {
    const ops = await fake.opsSignIn();
    const created = await http()
      .post('/v1/ops/promos')
      .set(ops.headers)
      .send({ code: 'Diwali25', description: '₹25 off for Diwali', descriptionTe: 'దీపావళికి ₹25 తగ్గింపు', kind: 'flat', value: 2500, validFrom: '2026-01-01T00:00:00Z', budgetPaise: 50000 })
      .expect(201);
    expect(created.body).toMatchObject({ code: 'DIWALI25', status: 'active', remainingPaise: 50000, minOrderPaise: 0 });
    await http().post('/v1/ops/promos').set(ops.headers).send({ code: 'DIWALI25', description: 'dup', descriptionTe: 'dup', kind: 'flat', value: 2500, validFrom: '2026-01-01T00:00:00Z' }).expect(409);
    await http().post('/v1/ops/promos').set(ops.headers).send({ code: 'PCT10', description: 'ten percent', descriptionTe: 'పది శాతం', kind: 'percent', value: 10, validFrom: '2026-01-01T00:00:00Z' }).expect(400);

    await putCart(consumer, kirana.id, bigCart()).expect(200);
    expect((await price(consumer, { promoCode: 'diwali25' }).expect(200)).body.promo).toMatchObject({ applied: true, discountPaise: 2500 });
    const paused = await http().patch(`/v1/ops/promos/${created.body.id}`).set(ops.headers).send({ active: false }).expect(200);
    expect(paused.body).toMatchObject({ status: 'paused', budgetPaise: 50000, minOrderPaise: 0 }); // PATCH leaves other fields alone
    expect((await price(consumer, { promoCode: 'DIWALI25' }).expect(200)).body.promo).toMatchObject({ applied: false, reason: 'inactive' });
    await http().patch(`/v1/ops/promos/${created.body.id}`).set(ops.headers).send({ active: true }).expect(200);

    const audit = (await http().get(`/v1/ops/audit?entity=promo&entityId=${created.body.id}`).set(ops.headers).expect(200)).body.items;
    expect(audit.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['promo.created', 'promo.paused', 'promo.resumed']));
    // Consumers cannot manage promos
    await http().get('/v1/ops/promos').set(consumer.headers).expect(403);
  });

  // ───────────── quote integrity ─────────────

  it('a bill change between quote and order → 409 QUOTE_CHANGED with a fresh quote', async () => {
    const owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    await putCart(consumer, kirana.id, bigCart()).expect(200);
    const q = (await price(consumer, {}).expect(200)).body;
    // The store starts charging ₹10 packaging (capped at the market's ₹20) after the customer saw the bill.
    const m = await http().patch('/v1/merchants/me').set(owner.headers).send({ packagingFeePaise: 1000 }).expect(200);
    expect(m.body.merchant.packagingFeePaise).toBe(1000);
    const res = await place(consumer, q.quoteId, 'cod').expect(409);
    expect(res.body.error).toMatchObject({ code: 'QUOTE_CHANGED', details: { previousTotalPaise: q.bill.totalPaise, totalPaise: q.bill.totalPaise + 1000 } });
    // The fresh quote places fine
    const placed = await place(consumer, res.body.error.details.quoteId, 'cod').expect(201);
    expect(placed.body.bill.fees).toEqual(expect.arrayContaining([{ code: 'packaging', amountPaise: 1000, waivedPaise: 0 }]));
    await http().patch('/v1/merchants/me').set(owner.headers).send({ packagingFeePaise: 0 }).expect(200);
  });

  // ───────────── webhooks + expiry ─────────────

  it('Razorpay webhook: bad signature 401; captured → PLACED; duplicate delivery ignored', async () => {
    await putCart(consumer, kirana.id, bigCart()).expect(200);
    const q = (await price(consumer, {}).expect(200)).body;
    const o = (await place(consumer, q.quoteId, 'online').expect(201)).body;
    const body = JSON.stringify({ event: 'payment.captured', created_at: 1, payload: { payment: { entity: { id: 'pay_wh_1', order_id: o.payment.providerOrderId, status: 'captured' } } } });
    const send = (sig: string) => http().post('/v1/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).set('X-Razorpay-Event-Id', 'evt_1').send(body);
    await send('nope').expect(401);
    expect((await send(hmacHex(MOCK_WEBHOOK_SECRET, body)).expect(200)).body).toEqual({ ok: true, duplicate: false });
    expect((await send(hmacHex(MOCK_WEBHOOK_SECRET, body)).expect(200)).body).toEqual({ ok: true, duplicate: true });
    expect((await http().get(`/v1/orders/${o.id}`).set(consumer.headers)).body.state).toBe('PLACED');
  });

  it('unpaid online orders lapse to PAYMENT_FAILED after the payment window; a late capture becomes wallet credit', async () => {
    await putCart(consumer, kirana.id, bigCart()).expect(200);
    const q = (await price(consumer, {}).expect(200)).body;
    const o = (await place(consumer, q.quoteId, 'online').expect(201)).body;
    await http().post(`/v1/dev/payments/${o.payment.intentId}/fail`).expect(200); // a failed attempt keeps the order open
    expect((await http().get(`/v1/orders/${o.id}`).set(consumer.headers)).body).toMatchObject({ state: 'AWAITING_PAYMENT', payment: { lastFailure: expect.stringContaining('declined') } });

    await fake.advanceClock(16 / 60);
    const sweep = await http().post('/v1/dev/jobs/payment-expiry').expect(200);
    expect(sweep.body.expired).toBeGreaterThanOrEqual(1);
    const lapsed = (await http().get(`/v1/orders/${o.id}`).set(consumer.headers)).body;
    expect(lapsed).toMatchObject({ state: 'PAYMENT_FAILED', payment: { status: 'failed' } });

    const before = (await http().get('/v1/wallet').set(consumer.headers).expect(200)).body.balancePaise;
    await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    const wallet = (await http().get('/v1/wallet').set(consumer.headers).expect(200)).body;
    expect(wallet.balancePaise).toBe(before + o.totalPaise);
    expect(wallet.entries[0]).toMatchObject({ kind: 'refund_credit', orderId: o.id, amountPaise: o.totalPaise });
    expect((await http().get(`/v1/orders/${o.id}`).set(consumer.headers)).body.state).toBe('PAYMENT_FAILED');
  });

  it('expired quotes are refused; orders are private', async () => {
    await putCart(consumer, kirana.id, bigCart()).expect(200);
    const q = (await price(consumer, {}).expect(200)).body;
    const other = await fake.signIn('9876500409', 'consumer');
    await place(other, q.quoteId, 'cod').expect(404);
    const mine = (await http().get('/v1/orders').set(consumer.headers)).body.items[0];
    await http().get(`/v1/orders/${mine.id}`).set(other.headers).expect(404);
    await fake.advanceClock(31 / 60);
    const res = await place(consumer, q.quoteId, 'cod').expect(409);
    expect(res.body.error.code).toBe('QUOTE_EXPIRED');
  });

  it('kitchen slots: a booked order counts against the slot shown on the store page', async () => {
    const s = await fake.signIn('9876500410', 'consumer');
    await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: '12, Dargamitta 3rd Lane', location: dargamitta }).expect(201);
    const addressId = (await http().get('/v1/me/addresses').set(s.headers)).body.items[0].id;
    const before = (await store(kitchen.id)).slots.occurrences.filter((o: { state: string }) => o.state === 'open');
    const slot = before[before.length - 1];
    await putCart(s, kitchen.id, [line(kitchenItems, 'Veg Meals', 2)]).expect(200);
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId, when: { mode: 'slot', slotId: slot.slotId, date: slot.date } }).expect(200)).body;
    expect(q.problems).toEqual([]);
    const o = (await place(s, q.quoteId, 'online').expect(201)).body;
    expect(o.when).toMatchObject({ mode: 'slot', slotId: slot.slotId, date: slot.date });
    const after = (await store(kitchen.id)).slots.occurrences.find((x: { slotId: string; date: string }) => x.slotId === slot.slotId && x.date === slot.date);
    expect(after.booked).toBe(slot.booked + 1);
  });
});
