/** M6 repository contracts — riders, fulfilments (compare-and-swap) and offers (memory + Prisma). */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DispatchRepository, FulfilmentRecord, OfferRecord } from '../../src/modules/dispatch-tracking/dispatch.repository';

const fulfilment = (over: Partial<FulfilmentRecord> = {}): Omit<FulfilmentRecord, 'updatedAt'> => ({
  id: randomUUID(),
  orderId: randomUUID(),
  merchantId: randomUUID(),
  microMarketId: randomUUID(),
  mode: 'rider',
  state: 'searching',
  staffId: null,
  staffToken: null,
  riderUserId: null,
  tplRef: null,
  pickupCode: '1234',
  deliveryOtp: '5678',
  fallbackStage: 'none',
  selfBonusPaise: 0,
  storeToDropM: 1500,
  riderPayPaise: 0,
  payLines: [],
  batchedWith: null,
  promisedAt: new Date(Date.now() + 30 * 60_000),
  etaAt: null,
  delayNotifiedAt: null,
  proof: null,
  proofMediaId: null,
  codCollectedPaise: null,
  lastLat: null,
  lastLng: null,
  lastLocationAt: null,
  requestedAt: new Date(),
  assignedAt: null,
  arrivedAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  failedAt: null,
  ...over,
});

const offer = (fulfilmentId: string, riderUserId: string, over: Partial<OfferRecord> = {}): OfferRecord => ({
  id: randomUUID(),
  fulfilmentId,
  riderUserId,
  state: 'offered',
  payPaise: 4400,
  payLines: [
    { code: 'base', amountPaise: 3000 },
    { code: 'distance', amountPaise: 1400 },
  ],
  distanceM: 500,
  offeredAt: new Date(),
  expiresAt: new Date(Date.now() + 30_000),
  respondedAt: null,
  ...over,
});

/** `riderId()` creates a user the rider row can point at (Prisma has no FK, but keep ids real). */
export function dispatchRepositoryContract(name: string, make: () => Promise<{ repo: DispatchRepository; riderId: () => Promise<string> }>) {
  describe(`DispatchRepository contract · ${name}`, () => {
    it('riders: upsert keeps stats, update patches, online filter, offer counters', async () => {
      const { repo, riderId } = await make();
      const id = await riderId();
      const r = await repo.upsertRider({ userId: id, name: 'Kiran' });
      expect(r).toMatchObject({ userId: id, name: 'Kiran', online: false, zones: [], offersShown: 0 });
      const zone = randomUUID();
      await repo.updateRider(id, { online: true, zones: [zone] });
      await repo.countOffer(id, false);
      await repo.countOffer(id, false);
      await repo.countOffer(id, true);
      await repo.upsertRider({ userId: id, name: 'Kiran K' });
      const again = (await repo.getRider(id))!;
      expect(again).toMatchObject({ name: 'Kiran K', online: true, zones: [zone], offersShown: 2, offersAccepted: 1 });
      expect((await repo.riders({ online: true })).map((x) => x.userId)).toContain(id);
      expect(await repo.updateRider(randomUUID(), { online: true })).toBeNull();
    });

    it('fulfilments: one per order, by token, compare-and-swap on state, active filters', async () => {
      const { repo } = await make();
      const token = `tok-${randomUUID()}`;
      const f = await repo.createFulfilment(fulfilment({ mode: 'self', state: 'assigned', staffToken: token, payLines: [{ code: 'base', amountPaise: 1 }] }));
      await expect(repo.createFulfilment(fulfilment({ orderId: f.orderId }))).rejects.toThrow();
      expect((await repo.fulfilmentByToken(token))?.id).toBe(f.id);
      expect((await repo.fulfilmentForOrder(f.orderId))?.payLines).toEqual([{ code: 'base', amountPaise: 1 }]);

      expect(await repo.updateFulfilment(f.id, 'searching', { state: 'picked_up' })).toBeNull(); // wrong expected state
      const picked = await repo.updateFulfilment(f.id, ['assigned', 'searching'], { state: 'picked_up', pickedUpAt: new Date() });
      expect(picked?.state).toBe('picked_up');
      expect((await repo.activeFulfilments({ merchantId: f.merchantId })).map((x) => x.id)).toEqual([f.id]);
      await repo.updateFulfilment(f.id, null, { state: 'delivered', deliveredAt: new Date() });
      expect(await repo.activeFulfilments({ merchantId: f.merchantId })).toEqual([]);
      expect((await repo.deliveredForMerchant(f.merchantId, new Date(Date.now() - 60_000))).map((x) => x.id)).toEqual([f.id]);
    });

    it('offers: one winner on concurrent accept/expire; open offers per rider', async () => {
      const { repo, riderId } = await make();
      const rider = await riderId();
      const f = await repo.createFulfilment(fulfilment());
      const o = await repo.createOffer(offer(f.id, rider));
      expect((await repo.openOffersForRider(rider)).map((x) => x.id)).toEqual([o.id]);
      const [a, b] = await Promise.all([
        repo.updateOffer(o.id, 'offered', { state: 'accepted', respondedAt: new Date() }),
        repo.updateOffer(o.id, 'offered', { state: 'expired', respondedAt: new Date() }),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(await repo.openOffersForRider(rider)).toEqual([]);
      expect((await repo.offersFor(f.id))[0]!.payLines).toHaveLength(2);

      // Two riders racing for one fulfilment: only one assignment sticks.
      const [x, y] = await Promise.all([
        repo.updateFulfilment(f.id, 'searching', { state: 'assigned', riderUserId: rider }),
        repo.updateFulfilment(f.id, 'searching', { state: 'assigned', riderUserId: randomUUID() }),
      ]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
      expect((await repo.activeFulfilments({ riderUserId: rider })).length + (x ? 0 : 1)).toBe(1);
    });
  });
}
