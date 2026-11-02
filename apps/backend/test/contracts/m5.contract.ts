/** M5 repository contracts — order lifecycle edits and the notifications store (memory + Prisma). */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { NotificationRepository } from '../../src/modules/notifications/notifications.repository';
import type { NewOrder, OrderRepository } from '../../src/modules/orders/orders.repository';

const order = (over: Partial<NewOrder> = {}): NewOrder => {
  const id = randomUUID();
  return {
    id,
    code: `SN${id.slice(0, 6).toUpperCase()}`,
    userId: randomUUID(),
    merchantId: randomUUID(),
    microMarketId: randomUUID(),
    state: 'PLACED',
    paymentMethod: 'cod',
    fulfilmentWhen: 'asap',
    slotId: null,
    slotDate: null,
    slotStartsAt: null,
    address: { addressId: null, label: 'home', name: null, line: '1, Test Street', landmark: null, pincode: null, location: { lat: 14.45, lng: 79.99 } },
    instructions: null,
    itemsPaise: 30000,
    feesPaise: 500,
    taxPaise: 90,
    discountPaise: 0,
    totalPaise: 30590,
    promoCode: null,
    quote: {},
    idempotencyKey: `k-${id}`,
    placedAt: new Date(),
    paymentDueAt: null,
    lines: [
      { itemId: randomUUID(), variantId: randomUUID(), name: 'Atta', variantLabel: '1 kg', quantity: 2, unitPricePaise: 10000, mrpPaise: null, linePaise: 20000, substitution: 'similar' },
      { itemId: randomUUID(), variantId: randomUUID(), name: 'Rice', variantLabel: '1 kg', quantity: 1, unitPricePaise: 10000, mrpPaise: null, linePaise: 10000, substitution: 'call_me' },
    ],
    ...over,
  };
};
const actor = { type: 'customer', id: null };

export function orderLifecycleContract(name: string, make: () => Promise<OrderRepository>) {
  describe(`OrderRepository lifecycle contract · ${name}`, () => {
    it('transition sets lifecycle columns; line edits and refunds persist', async () => {
      const repo = await make();
      const o = await repo.transaction((tx) => tx.insert(order(), actor));
      expect(o).toMatchObject({ refundedPaise: 0, fulfilmentMode: null, acceptedAt: null });
      expect(o.lines[0]).toMatchObject({ status: 'ok', refundPaise: 0 });
      const at = new Date();
      await repo.transaction((tx) => tx.transition(o.id, { from: 'PLACED', to: 'ACCEPTED', actor: { type: 'merchant', id: null }, set: { acceptedAt: at, fulfilmentMode: 'self', packBy: at } }));
      const v = o.lines[0]!.variantId;
      await repo.transaction(async (tx) => {
        expect((await tx.lock(o.id))!.state).toBe('ACCEPTED');
        await tx.updateLine(o.id, v, { status: 'substituted', substituteItemId: randomUUID(), substituteVariantId: randomUUID(), substituteName: 'Other atta', substituteVariantLabel: '1 kg', substituteUnitPaise: 9000, refundPaise: 2000 });
        await tx.addRefund(o.id, 2000);
      });
      const got = (await repo.get(o.id))!;
      expect(got).toMatchObject({ state: 'ACCEPTED', fulfilmentMode: 'self', refundedPaise: 2000 });
      expect(got.acceptedAt?.getTime()).toBe(at.getTime());
      expect(got.lines.find((l) => l.variantId === v)).toMatchObject({ status: 'substituted', substituteName: 'Other atta', substituteUnitPaise: 9000, refundPaise: 2000 });
      expect(got.lines.find((l) => l.variantId !== v)).toMatchObject({ status: 'ok', refundPaise: 0 });
    });

    it('lists a store’s orders by state and since; ops lists recent by state', async () => {
      const repo = await make();
      const merchantId = randomUUID();
      const a = await repo.transaction((tx) => tx.insert(order({ merchantId }), actor));
      const b = await repo.transaction((tx) => tx.insert(order({ merchantId, state: 'REJECTED' }), actor));
      expect((await repo.listForMerchant(merchantId, { limit: 10 })).map((o) => o.id)).toEqual([b.id, a.id]);
      expect((await repo.listForMerchant(merchantId, { states: ['PLACED'], limit: 10 })).map((o) => o.id)).toEqual([a.id]);
      expect(await repo.listForMerchant(merchantId, { since: new Date(Date.now() + 60_000), limit: 10 })).toEqual([]);
      expect((await repo.listRecent({ states: ['REJECTED'], limit: 500 })).map((o) => o.id)).toContain(b.id);
    });
  });
}

export function notificationRepositoryContract(name: string, make: () => Promise<{ repo: NotificationRepository; userId: () => Promise<string> }>) {
  describe(`NotificationRepository contract · ${name}`, () => {
    it('logs per order in order; tokens are one per device; opt-ins default off', async () => {
      const { repo, userId } = await make();
      const u = await userId();
      const orderId = randomUUID();
      const base = { userId: u, merchantId: null, orderId, locale: 'en', status: 'sent' as const, provider: 'mock', error: null };
      await repo.log({ ...base, channel: 'push', template: 'a', body: 'first' });
      await repo.log({ ...base, channel: 'sms', template: 'b', body: 'second' });
      expect((await repo.forOrder(orderId)).map((n) => n.body)).toEqual(['first', 'second']);
      expect((await repo.forUser(u, 1)).map((n) => n.body)).toEqual(['second']);

      const device = `dev-${randomUUID()}`;
      await repo.upsertToken({ deviceId: device, userId: u, token: 'token-one-000000', platform: 'android' });
      await repo.upsertToken({ deviceId: device, userId: u, token: 'token-two-000000', platform: 'android' });
      expect((await repo.tokensFor(u)).map((t) => t.token)).toEqual(['token-two-000000']);
      await repo.removeToken('token-two-000000');
      expect(await repo.tokensFor(u)).toEqual([]);

      expect(await repo.whatsappOptIn(u)).toBe(false);
      await repo.setWhatsappOptIn(u, true);
      expect(await repo.whatsappOptIn(u)).toBe(true);
    });
  });
}
