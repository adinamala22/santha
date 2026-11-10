/**
 * M4 repository contracts — run against the in-memory stores (test:unit) and Prisma (test:int), so
 * fake mode cannot drift from Postgres on the parts money depends on: order state compare-and-swap,
 * idempotency-key uniqueness, slot bookings, promo budget compare-and-swap, payment capture and
 * webhook dedupe.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CartPricingRepository } from '../../src/modules/cart-pricing/cart-pricing.repository';
import type { NewOrder, OrderRepository } from '../../src/modules/orders/orders.repository';
import type { PaymentsRepository } from '../../src/modules/payments-settlement/payments.repository';

const actor = { type: 'customer', id: null };

function newOrder(over: Partial<NewOrder> = {}): NewOrder {
  const id = randomUUID();
  return {
    id,
    code: `SN${id.slice(0, 6).toUpperCase()}`,
    userId: randomUUID(),
    merchantId: randomUUID(),
    microMarketId: randomUUID(),
    state: 'AWAITING_PAYMENT',
    paymentMethod: 'online',
    fulfilmentWhen: 'asap',
    slotId: null,
    slotDate: null,
    slotStartsAt: null,
    address: { addressId: null, label: 'home', name: null, line: '1, Test Street', landmark: null, pincode: null, location: { lat: 14.45, lng: 79.99 } },
    instructions: null,
    itemsPaise: 20000,
    feesPaise: 500,
    taxPaise: 90,
    discountPaise: 0,
    totalPaise: 20590,
    promoCode: null,
    quote: { any: 'json' },
    idempotencyKey: `k-${id}`,
    placedAt: null,
    paymentDueAt: new Date(Date.now() + 15 * 60_000),
    lines: [{ itemId: randomUUID(), variantId: randomUUID(), name: 'Atta', variantLabel: '1 kg', quantity: 2, unitPricePaise: 10000, mrpPaise: 11000, linePaise: 20000, substitution: 'call_me' }],
    ...over,
  };
}

export function orderRepositoryContract(name: string, make: () => Promise<OrderRepository>) {
  describe(`OrderRepository contract · ${name}`, () => {
    it('inserts with lines and history; transition is compare-and-swap on the current state', async () => {
      const repo = await make();
      const o = await repo.transaction((tx) => tx.insert(newOrder(), actor));
      expect(o.lines).toHaveLength(1);
      const at = new Date();
      expect(await repo.transaction((tx) => tx.transition(o.id, { from: 'AWAITING_PAYMENT', to: 'PLACED', actor: { type: 'system', id: null }, reason: 'paid', set: { placedAt: at } }))).toBe(true);
      // A second, stale move from the old state loses.
      expect(await repo.transaction((tx) => tx.transition(o.id, { from: 'AWAITING_PAYMENT', to: 'PAYMENT_FAILED', actor: { type: 'system', id: null } }))).toBe(false);
      const got = (await repo.get(o.id))!;
      expect(got.state).toBe('PLACED');
      expect(got.placedAt?.getTime()).toBe(at.getTime());
      expect((await repo.history(o.id)).map((h) => [h.from, h.to])).toEqual([
        [null, 'AWAITING_PAYMENT'],
        ['AWAITING_PAYMENT', 'PLACED'],
      ]);
    });

    it('idempotency key is unique per user; lookups and counts', async () => {
      const repo = await make();
      const first = newOrder({ state: 'PLACED', paymentMethod: 'cod' });
      await repo.transaction((tx) => tx.insert(first, actor));
      await expect(repo.transaction((tx) => tx.insert(newOrder({ userId: first.userId, idempotencyKey: first.idempotencyKey }), actor))).rejects.toThrow();
      expect((await repo.getByIdempotencyKey(first.userId, first.idempotencyKey))!.id).toBe(first.id);
      await repo.transaction((tx) => tx.insert(newOrder({ userId: first.userId, state: 'AWAITING_PAYMENT' }), actor));
      expect(await repo.countPlaced(first.userId)).toBe(1);
      expect(await repo.countOpenCod(first.userId)).toBe(1);
      expect((await repo.listForUser(first.userId, 10)).length).toBe(2);
    });

    it('slot bookings and portions count holding orders only; due unpaid orders are found', async () => {
      const repo = await make();
      const merchantId = randomUUID();
      const slotId = randomUUID();
      const slot = { merchantId, slotId, slotDate: '2026-11-06', fulfilmentWhen: 'slot' as const };
      const a = newOrder({ ...slot, state: 'PLACED' });
      const b = newOrder({ ...slot, state: 'AWAITING_PAYMENT', paymentDueAt: new Date(Date.now() - 1000) });
      const c = newOrder({ ...slot, state: 'PAYMENT_FAILED' });
      for (const o of [a, b, c]) await repo.transaction((tx) => tx.insert(o, actor));
      expect((await repo.slotBookings(merchantId, ['2026-11-06'])).get(`${slotId}|2026-11-06`)).toBe(2);
      expect((await repo.itemPortions(merchantId, '2026-11-06')).get(a.lines[0]!.itemId)).toBe(2);
      expect((await repo.awaitingPaymentDue(new Date(), 100)).map((o) => o.id)).toContain(b.id);
      expect((await repo.awaitingPaymentDue(new Date(), 100)).map((o) => o.id)).not.toContain(a.id);
    });
  });
}

export function promoRepositoryContract(name: string, make: () => Promise<CartPricingRepository>) {
  describe(`CartPricingRepository contract · ${name}`, () => {
    const promo = () => ({
      code: `C${randomUUID().slice(0, 8).toUpperCase()}`,
      description: 'test',
      descriptionTe: 'test',
      kind: 'flat' as const,
      value: 6000,
      maxDiscountPaise: null,
      minOrderPaise: 0,
      budgetPaise: 10000,
      perUserLimit: 5,
      firstOrderOnly: false,
      merchantSharePercent: 0,
      microMarketIds: [],
      merchantTypes: [],
      merchantIds: [],
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: null,
      active: true,
      createdBy: null,
    });

    it('budget reservation is compare-and-swap and never exceeds the budget; release gives it back', async () => {
      const repo = await make();
      const p = await repo.transaction((tx) => tx.createPromo(promo()));
      expect(await repo.transaction((tx) => tx.reserveBudget(p.id, 6000))).toBe(true);
      expect(await repo.transaction((tx) => tx.reserveBudget(p.id, 6000))).toBe(false);
      expect((await repo.getPromo(p.id))!.spentPaise).toBe(6000);
      await repo.transaction((tx) => tx.releaseBudget(p.id, 6000));
      expect(await repo.transaction((tx) => tx.reserveBudget(p.id, 6000))).toBe(true);
      await repo.transaction((tx) => tx.updatePromo(p.id, { active: false }));
      await repo.transaction((tx) => tx.releaseBudget(p.id, 6000));
      expect(await repo.transaction((tx) => tx.reserveBudget(p.id, 100))).toBe(false); // inactive
    });

    it('codes are unique; redemptions move one way per status', async () => {
      const repo = await make();
      const input = promo();
      const p = await repo.transaction((tx) => tx.createPromo(input));
      await expect(repo.transaction((tx) => tx.createPromo({ ...input }))).rejects.toThrow();
      const orderId = randomUUID();
      const userId = randomUUID();
      await repo.transaction((tx) => tx.insertRedemption({ promoId: p.id, userId, orderId, discountPaise: 6000, merchantSharePaise: 0, status: 'reserved' }));
      expect(await repo.activeRedemptions(p.id, userId)).toBe(1);
      expect(await repo.transaction((tx) => tx.setRedemptionStatus(orderId, 'reserved', 'released'))).toBe(true);
      expect(await repo.transaction((tx) => tx.setRedemptionStatus(orderId, 'reserved', 'released'))).toBe(false);
      expect(await repo.activeRedemptions(p.id, userId)).toBe(0);
      expect((await repo.getPromoByCode(input.code))!.id).toBe(p.id);
    });

    it('carts and quotes round-trip', async () => {
      const repo = await make();
      const userId = randomUUID();
      const merchantId = randomUUID();
      await repo.putCart({ userId, merchantId, lines: [{ itemId: randomUUID(), variantId: randomUUID(), quantity: 2, substitution: 'similar' }] });
      expect((await repo.getCart(userId))!.lines[0]!.substitution).toBe('similar');
      await repo.deleteCart(userId);
      expect(await repo.getCart(userId)).toBeNull();
      const q = await repo.saveQuote({ id: randomUUID(), userId, merchantId, microMarketId: randomUUID(), totalPaise: 123, snapshot: { a: [1, 2] }, expiresAt: new Date(Date.now() + 60_000) });
      expect((await repo.getQuote<{ a: number[] }>(q.id))!.snapshot.a).toEqual([1, 2]);
    });
  });
}

export function paymentsRepositoryContract(name: string, make: () => Promise<PaymentsRepository>) {
  describe(`PaymentsRepository contract · ${name}`, () => {
    const intent = () => ({ id: randomUUID(), orderId: randomUUID(), userId: randomUUID(), microMarketId: randomUUID(), amountPaise: 20590, currency: 'INR', provider: 'mock', providerOrderId: `order_${randomUUID()}` });

    it('capture is compare-and-swap; a capture after failure is still recorded once', async () => {
      const repo = await make();
      const i = await repo.transaction((tx) => tx.insertIntent(intent()));
      expect(i.status).toBe('created');
      expect(await repo.transaction((tx) => tx.markFailed(i.id, 'payment_timeout'))).toBe(true);
      expect(await repo.transaction((tx) => tx.markFailed(i.id, 'again'))).toBe(false);
      expect(await repo.transaction((tx) => tx.markCaptured(i.id, 'pay_1', new Date()))).toBe(true);
      expect(await repo.transaction((tx) => tx.markCaptured(i.id, 'pay_2', new Date()))).toBe(false);
      expect(await repo.intentByProviderOrder(i.providerOrderId)).toMatchObject({ status: 'captured', providerPaymentId: 'pay_1' });
      expect((await repo.intentForOrder(i.orderId))!.id).toBe(i.id);
    });

    it('ADR-037: a tip payment is captured once, found by order and provider order, and listed by rider and day', async () => {
      const repo = await make();
      const rider = randomUUID();
      const t = await repo.transaction((tx) => tx.insertTip({ id: randomUUID(), orderId: randomUUID(), userId: randomUUID(), riderUserId: rider, microMarketId: randomUUID(), amountPaise: 2000, currency: 'INR', provider: 'mock', providerOrderId: `order_${randomUUID()}` }));
      expect(t.status).toBe('created');
      await repo.transaction((tx) => tx.noteTipFailure(t.id, 'declined'));
      expect((await repo.getTip(t.id))!.failureReason).toBe('declined');
      expect(await repo.capturedTipsForRider(rider, new Date(0), new Date(Date.now() + 60_000))).toEqual([]);
      const at = new Date();
      expect(await repo.transaction((tx) => tx.markTipCaptured(t.id, 'pay_t1', at))).toBe(true);
      expect(await repo.transaction((tx) => tx.markTipCaptured(t.id, 'pay_t2', at))).toBe(false);
      expect(await repo.tipByProviderOrder(t.providerOrderId)).toMatchObject({ status: 'captured', providerPaymentId: 'pay_t1' });
      expect((await repo.tipsForOrder(t.orderId)).map((x) => x.id)).toEqual([t.id]);
      expect((await repo.capturedTipsForRider(rider, new Date(at.getTime() - 1000), new Date(at.getTime() + 1000))).map((x) => x.id)).toEqual([t.id]);
      expect(await repo.capturedTipsForRider(rider, new Date(at.getTime() + 1000), new Date(at.getTime() + 2000))).toEqual([]); // outside the window
      expect((await repo.capturedTipsBetween(new Date(at.getTime() - 1000), new Date(at.getTime() + 1000))).some((x) => x.id === t.id)).toBe(true);
      // The provider order id is unique.
      await expect(repo.transaction((tx) => tx.insertTip({ id: randomUUID(), orderId: t.orderId, userId: t.userId, riderUserId: rider, microMarketId: t.microMarketId, amountPaise: 1000, currency: 'INR', provider: 'mock', providerOrderId: t.providerOrderId }))).rejects.toBeTruthy();
    });

    it('webhooks dedupe on (provider, event id); wallet balance sums entries', async () => {
      const repo = await make();
      const evt = `evt_${randomUUID()}`;
      expect(await repo.transaction((tx) => tx.insertWebhook({ provider: 'mock', providerEventId: evt, eventType: 'payment.captured', payload: { a: 1 } }))).toBe(true);
      expect(await repo.transaction((tx) => tx.insertWebhook({ provider: 'mock', providerEventId: evt, eventType: 'payment.captured', payload: { a: 1 } }))).toBe(false);
      await repo.transaction((tx) => tx.markWebhookProcessed('mock', evt));
      const userId = randomUUID();
      for (const amount of [1000, 2500]) await repo.transaction((tx) => tx.addWalletEntry({ userId, amountPaise: amount, kind: 'refund_credit', orderId: null, note: 'test', createdBy: null }));
      expect(await repo.walletBalance(userId)).toBe(3500);
      expect((await repo.walletEntries(userId, 10)).length).toBe(2);
    });
  });
}
