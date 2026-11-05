/**
 * Repository contracts: the behaviour every implementation of a storage port must share.
 * Each contract runs twice — against the in-memory store (test:unit, `*.repository.spec.ts`)
 * and against Prisma + PostGIS (test:int, `test/integration/repositories.int.spec.ts`) — so the
 * fake used by `pnpm dev:fake` cannot silently drift from Postgres (santha-backend "Fake service").
 * Tests use unique slugs/ids so they can share one database.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rect } from '../../src/common/geo/polygon';
import { everyDay } from '../../src/common/hours';
import { DEFAULT_CONFIG } from '../../src/modules/analytics-config/domain/micro-market-config';
import type { MicroMarketRepository } from '../../src/modules/analytics-config/micro-markets.repository';
import type { KycCheckInput, KycRepository } from '../../src/modules/identity-kyc/kyc.repository';
import type { MerchantRepository } from '../../src/modules/merchant-catalogue/merchants.repository';

const uniq = () => randomUUID().slice(0, 8);
const T0 = new Date('2026-03-01T00:00:00Z');
const T1 = new Date('2026-04-01T00:00:00Z');

export function microMarketRepositoryContract(name: string, make: () => Promise<MicroMarketRepository>) {
  describe(`MicroMarketRepository contract · ${name}`, () => {
    /** A fresh city far from anything else (each test gets its own longitude band). */
    async function world(repo: MicroMarketRepository) {
      const s = uniq();
      const lng0 = 10 + Math.random() * 100;
      return repo.transaction(async (tx) => {
        const city = await tx.createCity({ slug: `c-${s}`, name: `City ${s}`, nameTe: 'నగరం', state: 'AP' });
        const a = await tx.createMarket({ cityId: city.id, slug: `a-${s}`, name: `A ${s}`, nameTe: 'ఎ' });
        const b = await tx.createMarket({ cityId: city.id, slug: `b-${s}`, name: `B ${s}`, nameTe: 'బి' });
        const va = await tx.insertVersion({
          ...DEFAULT_CONFIG, polygon: rect(lng0, 10, lng0 + 0.01, 10.01), microMarketId: a.id, version: 1, effectiveFrom: T0, note: null, createdBy: null,
        });
        await tx.insertVersion({
          ...DEFAULT_CONFIG, polygon: rect(lng0 + 0.01, 10, lng0 + 0.02, 10.01), microMarketId: b.id, version: 1, effectiveFrom: T0, note: null, createdBy: null,
        });
        return { city, a, b, va, lng0 };
      });
    }

    it('stores versions with their config and polygon', async () => {
      const repo = await make();
      const { a, lng0 } = await world(repo);
      const [v] = await repo.versions(a.id);
      expect(v).toMatchObject({ version: 1, effectiveTo: null, fees: DEFAULT_CONFIG.fees, hours: DEFAULT_CONFIG.hours });
      expect(v!.effectiveFrom.toISOString()).toBe(T0.toISOString());
      expect(v!.polygon.coordinates[0][0]).toEqual([Math.round(lng0 * 1e7) / 1e7, 10]); // stored at 7 decimals
    });

    it('resolves points by the version effective at the time (ST_Covers semantics)', async () => {
      const repo = await make();
      const { a, b, lng0 } = await world(repo);
      expect((await repo.resolvePoint({ lat: 10.005, lng: lng0 + 0.005 }, T1))?.market.id).toBe(a.id);
      expect((await repo.resolvePoint({ lat: 10.005, lng: lng0 + 0.015 }, T1))?.market.id).toBe(b.id);
      expect(await repo.resolvePoint({ lat: 10.005, lng: lng0 + 0.005 }, new Date('2026-02-01T00:00:00Z'))).toBeNull(); // before v1
      expect(await repo.resolvePoint({ lat: 10.05, lng: lng0 + 0.005 }, T1)).toBeNull();
      // Just inside the southern edge. Exactly-on-edge is not compared: PostGIS edges are geodesic
      // arcs, the fake's are straight lines (they differ by nanometres).
      expect((await repo.resolvePoint({ lat: 10.00001, lng: lng0 + 0.005 }, T1))?.market.id).toBe(a.id);
    });

    it('nearest area: 0 m inside, distance to the edge outside (ST_Distance semantics); city coverage round-trips', async () => {
      const repo = await make();
      const { city, a, b, lng0 } = await world(repo);
      const inside = await repo.nearest({ lat: 10.005, lng: lng0 + 0.015 }, T1);
      expect(inside).toMatchObject({ market: { id: b.id }, distanceM: 0 });
      // 0.01° south of A's southern edge ≈ 1106 m (latitude 10°)
      const south = await repo.nearest({ lat: 9.99, lng: lng0 + 0.005 }, T1);
      expect(south?.market.id).toBe(a.id);
      expect(south!.distanceM).toBeGreaterThan(1090);
      expect(south!.distanceM).toBeLessThan(1120);
      expect(await repo.nearest({ lat: 9.99, lng: lng0 + 0.005 }, new Date('2026-02-01T00:00:00Z'))).toBeNull();

      expect((await repo.getCity(city.id))?.coverage).toEqual({ nearestFallback: false, maxDistanceM: 5000 });
      const updated = await repo.transaction((tx) => tx.updateCityCoverage(city.id, { nearestFallback: true, maxDistanceM: 8000 }));
      expect(updated?.coverage).toEqual({ nearestFallback: true, maxDistanceM: 8000 });
      expect((await repo.findCityBySlug(city.slug))?.coverage).toEqual({ nearestFallback: true, maxDistanceM: 8000 });
      expect(await repo.transaction((tx) => tx.updateCityCoverage(randomUUID(), { nearestFallback: true, maxDistanceM: 8000 }))).toBeNull();
    });

    it('detects interior overlap with other markets only (shared edges are fine)', async () => {
      const repo = await make();
      const { city, a, b, lng0 } = await world(repo);
      const straddle = rect(lng0 + 0.005, 10.002, lng0 + 0.015, 10.008);
      expect((await repo.overlapping(city.id, straddle, T1)).map((h) => h.microMarketId).sort()).toEqual([a.id, b.id].sort());
      expect((await repo.overlapping(city.id, straddle, T1, a.id)).map((h) => h.microMarketId)).toEqual([b.id]);
      const touching = rect(lng0 + 0.02, 10, lng0 + 0.03, 10.01); // shares B's east edge
      expect(await repo.overlapping(city.id, touching, T1)).toEqual([]);
    });

    it('closing a version moves the effective config to the next one', async () => {
      const repo = await make();
      const { a, va, lng0 } = await world(repo);
      await repo.transaction(async (tx) => {
        const latest = await tx.lockLatestVersion(a.id);
        expect(latest?.id).toBe(va.id);
        await tx.closeVersion(va.id, T1);
        await tx.insertVersion({
          ...DEFAULT_CONFIG, polygon: rect(lng0, 10, lng0 + 0.01, 10.02), microMarketId: a.id, version: 2, effectiveFrom: T1, note: 'grow', createdBy: null,
        });
      });
      const before = await repo.effectiveAt(new Date(T1.getTime() - 1));
      const after = await repo.effectiveAt(T1);
      expect(before.find((e) => e.market.id === a.id)?.version.version).toBe(1);
      expect(after.find((e) => e.market.id === a.id)?.version.version).toBe(2);
      expect((await repo.resolvePoint({ lat: 10.015, lng: lng0 + 0.005 }, T1))?.market.id).toBe(a.id);
    });

    it('rolls back the whole transaction on error, and version numbers are unique', async () => {
      const repo = await make();
      const { a, city } = await world(repo);
      const slug = `rollback-${uniq()}`;
      await expect(
        repo.transaction(async (tx) => {
          await tx.createMarket({ cityId: city.id, slug, name: 'Rollback', nameTe: 'ర' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await repo.getBySlug(slug)).toBeNull();
      await expect(
        repo.transaction((tx) =>
          tx.insertVersion({ ...DEFAULT_CONFIG, polygon: rect(0, 0, 1, 1), microMarketId: a.id, version: 1, effectiveFrom: T1, note: null, createdBy: null }),
        ),
      ).rejects.toThrow();
    });
  });
}

export function merchantRepositoryContract(name: string, make: () => Promise<MerchantRepository>) {
  describe(`MerchantRepository contract · ${name}`, () => {
    const create = (repo: MerchantRepository, extra: Partial<{ name: string }> = {}) =>
      repo.transaction((tx) =>
        tx.create({ ownerUserId: randomUUID(), type: 'retail', sellsFood: true, category: 'kirana', name: extra.name ?? `Store ${uniq()}` }),
      );

    it('creates drafts with defaults and finds them by id and owner', async () => {
      const repo = await make();
      const m = await create(repo);
      expect(m).toMatchObject({ status: 'draft', radiusM: 5000, deliversAnywhere: false, movPaise: 0, defaultFulfilment: 'rider', location: null, hours: null });
      expect((await repo.get(m.id))?.name).toBe(m.name);
      expect((await repo.findByOwner(m.ownerUserId))?.id).toBe(m.id);
      await expect(repo.transaction((tx) => tx.create({ ownerUserId: m.ownerUserId, type: 'fashion', sellsFood: false, category: null, name: 'Dup' }))).rejects.toThrow();
    });

    it('updates location (geography), hours (json) and status fields', async () => {
      const repo = await make();
      const m = await create(repo);
      const mm = randomUUID();
      const at = new Date('2026-05-01T10:00:00Z');
      const u = await repo.transaction((tx) =>
        tx.update(m.id, { location: { lat: 14.4525, lng: 79.995 }, microMarketId: mm, hours: everyDay('07:00', '21:00'), status: 'submitted', submittedAt: at }),
      );
      expect(u.location!.lat).toBeCloseTo(14.4525, 6);
      expect(u.location!.lng).toBeCloseTo(79.995, 6);
      expect(u).toMatchObject({ microMarketId: mm, status: 'submitted', hours: everyDay('07:00', '21:00') });
      expect(u.submittedAt?.toISOString()).toBe(at.toISOString());
    });

    it('lists by status oldest submission first, then by name', async () => {
      const repo = await make();
      const mm = randomUUID(); // scope to a fresh micro-market so other tests do not interfere
      const [x, y, z] = [await create(repo, { name: 'Zeta' }), await create(repo, { name: 'Alpha' }), await create(repo, { name: 'Mid' })];
      await repo.transaction(async (tx) => {
        await tx.update(x.id, { microMarketId: mm, status: 'submitted', submittedAt: new Date('2026-05-01T00:00:00Z') });
        await tx.update(y.id, { microMarketId: mm, status: 'submitted', submittedAt: new Date('2026-05-03T00:00:00Z') });
        await tx.update(z.id, { microMarketId: mm, status: 'live' });
      });
      expect((await repo.list({ microMarketId: mm, status: 'submitted', limit: 10 })).map((m) => m.name)).toEqual(['Zeta', 'Alpha']);
      expect((await repo.list({ microMarketId: mm, limit: 10 })).map((m) => m.name)).toEqual(['Zeta', 'Alpha', 'Mid']);
      expect(await repo.list({ microMarketId: mm, limit: 1 })).toHaveLength(1);
    });

    it('adds and removes staff; a phone is unique per store; rollback keeps nothing', async () => {
      const repo = await make();
      const m = await create(repo);
      const s = await repo.transaction((tx) => tx.addStaff({ merchantId: m.id, name: 'Suresh', phone: '+919000001999' }));
      await expect(repo.transaction((tx) => tx.addStaff({ merchantId: m.id, name: 'Again', phone: '+919000001999' }))).rejects.toThrow();
      expect((await repo.staff(m.id)).map((x) => x.name)).toEqual(['Suresh']);
      expect(await repo.transaction((tx) => tx.removeStaff(m.id, s.id))).toBe(true);
      expect(await repo.transaction((tx) => tx.removeStaff(m.id, s.id))).toBe(false);
      await expect(
        repo.transaction(async (tx) => {
          await tx.update(m.id, { name: 'Renamed' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect((await repo.get(m.id))?.name).toBe(m.name);
    });
  });
}

export function kycRepositoryContract(name: string, make: () => Promise<KycRepository>) {
  describe(`KycRepository contract · ${name}`, () => {
    const check = (over: Partial<KycCheckInput> = {}): KycCheckInput => ({
      kind: 'pan',
      status: 'verified',
      valueMasked: 'AB******4K',
      valuePublic: null,
      nameOnRecord: 'DEMO',
      provider: 'mock',
      providerRef: 'ref-1',
      failureReason: null,
      details: { a: 1 },
      verifiedAt: new Date('2026-05-01T00:00:00Z'),
      ...over,
    });
    const event = { type: 'merchant.kyc_updated', aggregate: { type: 'merchant', id: 'x' }, actor: { type: 'user' as const, id: null }, payload: {} };

    it('keeps one check per (subject, kind) and replaces it on re-run', async () => {
      const repo = await make();
      const subject = { type: 'merchant' as const, id: randomUUID() };
      await repo.save(subject, check({ status: 'failed', failureReason: 'nope', verifiedAt: null }), event);
      await repo.save(subject, check(), event);
      await repo.save(subject, check({ kind: 'bank', valueMasked: '•••• 9012' }), event);
      const all = await repo.list(subject);
      expect(all.map((c) => [c.kind, c.status])).toEqual([
        ['bank', 'verified'],
        ['pan', 'verified'],
      ]);
      expect(await repo.get(subject, 'pan')).toMatchObject({ failureReason: null, details: { a: 1 } });
      expect(await repo.list({ type: 'merchant', id: randomUUID() })).toEqual([]);
    });
  });
}
