/**
 * CatalogueRepository contract — runs against the in-memory store (test:unit) and Prisma
 * (test:int), like the contracts in repositories.contract.ts. Unique ids so tests share one DB.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CatalogueRepository, NewItem } from '../../src/modules/merchant-catalogue/catalogue.repository';
import type { MerchantRepository } from '../../src/modules/merchant-catalogue/merchants.repository';

const uniq = () => randomUUID().slice(0, 8);
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

export interface CatalogueRepos {
  catalogue: CatalogueRepository;
  merchants: MerchantRepository;
}

export function catalogueRepositoryContract(name: string, make: () => Promise<CatalogueRepos>) {
  describe(`CatalogueRepository contract · ${name}`, () => {
    const T = new Date('2026-06-01T10:00:00Z');
    const merchant = (r: CatalogueRepos) =>
      r.merchants.transaction((tx) => tx.create({ ownerUserId: randomUUID(), type: 'retail', sellsFood: true, category: 'kirana', name: `Store ${uniq()}` }));
    const v = (label: string, pricePaise: number, mrpPaise: number | null = null) => ({ label, unit: 'g' as const, unitQty: 500, pricePaise, mrpPaise });
    const item = (merchantId: string, extra: Partial<NewItem> = {}): NewItem => ({
      merchantId,
      microMarketId: null,
      masterProductId: null,
      name: `Item ${uniq()}`,
      nameTe: null,
      description: null,
      brand: null,
      categorySlug: 'staples',
      foodMark: 'veg',
      allergens: [],
      madeToOrder: false,
      leadTimeMin: null,
      maxPerOrder: null,
      availableDays: [],
      dailyCapacity: null,
      specialOn: null,
      status: 'active',
      reviewReason: null,
      source: 'merchant',
      imageIds: [],
      confirmedAt: T,
      createdBy: null,
      variants: [v('500 g', 5000, 6000)],
      ...extra,
    });

    it('creates items with ordered variants; lists by category then name; filters by text (name, Telugu, brand)', async () => {
      const r = await make();
      const m = await merchant(r);
      await r.catalogue.transaction(async (tx) => {
        await tx.createItem(item(m.id, { name: 'Toor Dal', categorySlug: 'staples', variants: [v('1 kg', 18000), v('500 g', 9500)] }));
        await tx.createItem(item(m.id, { name: 'Atta', categorySlug: 'staples', brand: 'Godavari Gold' }));
        await tx.createItem(item(m.id, { name: 'Curd', nameTe: 'పెరుగు', categorySlug: 'dairy' }));
      });
      const all = await r.catalogue.listItems({ merchantId: m.id, limit: 10 });
      expect(all.map((i) => i.name)).toEqual(['Curd', 'Atta', 'Toor Dal']); // dairy < staples, then by name
      expect(all[2]!.variants.map((x) => x.label)).toEqual(['1 kg', '500 g']);
      expect(all[2]!.variants[0]).toMatchObject({ unit: 'g', unitQty: 500, pricePaise: 18000, mrpPaise: null, stock: 'in', position: 0 });
      expect((await r.catalogue.listItems({ merchantId: m.id, q: 'GODAVARI', limit: 10 })).map((i) => i.name)).toEqual(['Atta']);
      expect((await r.catalogue.listItems({ merchantId: m.id, q: 'పెరుగు', limit: 10 })).map((i) => i.name)).toEqual(['Curd']);
      expect(await r.catalogue.countItems({ merchantId: m.id, categorySlug: 'staples' })).toBe(2);
      expect(await r.catalogue.listItems({ merchantId: m.id, limit: 1, offset: 2 })).toHaveLength(1);
    });

    it('replaces variants: kept ids are updated, missing ones deleted, new ones inserted', async () => {
      const r = await make();
      const m = await merchant(r);
      const i = await r.catalogue.transaction((tx) => tx.createItem(item(m.id, { variants: [v('A', 1000), v('B', 2000)] })));
      const a = i.variants[0]!;
      const u = await r.catalogue.transaction((tx) => tx.updateItem(i.id, { name: 'Renamed' }, [{ ...v('A2', 1100), id: a.id }, v('C', 3000)]));
      expect(u.name).toBe('Renamed');
      expect(u.variants.map((x) => [x.label, x.pricePaise])).toEqual([
        ['A2', 1100],
        ['C', 3000],
      ]);
      expect(u.variants[0]!.id).toBe(a.id);
    });

    it('refuses a selling price above the MRP (DB check) and rolls back', async () => {
      const r = await make();
      const m = await merchant(r);
      await expect(r.catalogue.transaction((tx) => tx.createItem(item(m.id, { name: 'Dear', variants: [v('x', 7000, 6000)] })))).rejects.toThrow();
      expect(await r.catalogue.countItems({ merchantId: m.id })).toBe(0);
    });

    it('stock per variant or all; confirmAll clears staleness; staleCandidates finds old active items only', async () => {
      const r = await make();
      const m = await merchant(r);
      const mm = randomUUID();
      const old = new Date('2026-01-01T00:00:00Z');
      const [a, b, , d] = await r.catalogue.transaction(async (tx) => [
        await tx.createItem(item(m.id, { microMarketId: mm, confirmedAt: old, variants: [v('1', 1000), v('2', 2000)] })),
        await tx.createItem(item(m.id, { microMarketId: mm, confirmedAt: new Date(old.getTime() + 1000) })),
        await tx.createItem(item(m.id, { microMarketId: mm, confirmedAt: old, status: 'hidden' })),
        await tx.createItem(item(m.id, { microMarketId: mm, confirmedAt: T })),
      ]);
      const s1 = await r.catalogue.transaction((tx) => tx.setStock(a!.id, a!.variants[1]!.id, 'out', T));
      expect(s1.variants.map((x) => x.stock)).toEqual(['in', 'out']);
      expect(s1.confirmedAt.toISOString()).toBe(T.toISOString());
      const s2 = await r.catalogue.transaction((tx) => tx.setStock(a!.id, null, 'low', T));
      expect(s2.variants.map((x) => x.stock)).toEqual(['low', 'low']);

      const before = new Date('2026-05-01T00:00:00Z');
      // a was just confirmed, the hidden one is not active, d is recent → only b.
      expect((await r.catalogue.staleCandidates(mm, before, 10)).map((x) => x.id)).toEqual([b!.id]);
      await r.catalogue.transaction((tx) => tx.flagStale([b!.id], T));
      expect((await r.catalogue.getItem(b!.id))!.staleSince?.toISOString()).toBe(T.toISOString());
      expect(await r.catalogue.staleCandidates(mm, before, 10)).toEqual([]);
      expect(await r.catalogue.countItems({ merchantId: m.id, staleOnly: true })).toBe(1);
      const touched = await r.catalogue.transaction((tx) => tx.confirmAll(m.id, new Date('2026-06-02T00:00:00Z')));
      expect(touched.sort()).toEqual([a!.id, b!.id, d!.id].sort());
      expect((await r.catalogue.getItem(b!.id))!.staleSince).toBeNull();
    });

    it('master products upsert by barcode; lookup by any alias; name search needs every word', async () => {
      const r = await make();
      const code = `89${digits(11)}`;
      const word = `w${uniq()}`;
      const base = {
        barcode: code,
        name: `Sona Masoori ${word}`,
        brand: 'Penna Valley',
        mrpPaise: 7200,
        packLabel: '1 kg',
        unit: 'kg' as const,
        unitQty: 1,
        categorySlug: 'staples',
        imageUrl: null,
        source: 'seed' as const,
      };
      const p = await r.catalogue.transaction((tx) => tx.upsertMaster(base));
      const p2 = await r.catalogue.transaction((tx) => tx.upsertMaster({ ...base, mrpPaise: 7500 }));
      expect(p2.id).toBe(p.id);
      expect((await r.catalogue.masterByBarcode(['0000', code]))?.mrpPaise).toBe(7500);
      expect(await r.catalogue.masterByBarcode(['0000'])).toBeNull();
      expect(await r.catalogue.searchMaster(`penna ${word} nosuchword`, 5)).toEqual([]);
      expect((await r.catalogue.searchMaster(`PENNA ${word.toUpperCase()}`, 5)).map((x) => x.id)).toEqual([p.id]);
      expect((await r.catalogue.getMaster(p.id))?.unitQty).toBe(1);
    });

    it('barcode requests count repeat scans and leave the open queue when resolved', async () => {
      const r = await make();
      const code = `0${digits(11)}`;
      await r.catalogue.transaction((tx) => tx.recordBarcodeRequest(code, null));
      const again = await r.catalogue.transaction((tx) => tx.recordBarcodeRequest(code, null));
      expect(again).toMatchObject({ barcode: code, scanCount: 2, status: 'open' });
      const master = await r.catalogue.transaction((tx) =>
        tx.upsertMaster({ barcode: code, name: 'X', brand: null, mrpPaise: null, packLabel: null, unit: null, unitQty: null, categorySlug: 'other_retail', imageUrl: null, source: 'ops' }),
      );
      await r.catalogue.transaction((tx) => tx.resolveBarcodeRequest(code, master.id, null, T));
      expect((await r.catalogue.barcodeRequests('open', 1000)).map((x) => x.barcode)).not.toContain(code);
      expect((await r.catalogue.barcodeRequests('resolved', 1000)).find((x) => x.barcode === code)?.masterProductId).toBe(master.id);
    });

    it('slots are replaced as a set, in order; media keeps variants JSON and lists oldest first', async () => {
      const r = await make();
      const m = await merchant(r);
      await r.catalogue.transaction((tx) => tx.replaceSlots(m.id, [{ label: 'Lunch', days: ['mon'], start: '12:30', end: '13:00', cutoffMin: 60, capacity: 5 }]));
      await r.catalogue.transaction((tx) =>
        tx.replaceSlots(m.id, [
          { label: 'Dinner', days: ['mon', 'tue'], start: '19:30', end: '20:00', cutoffMin: 90, capacity: 8 },
          { days: ['sun'], start: '12:00', end: '12:30', cutoffMin: 30, capacity: 3 },
        ]),
      );
      expect((await r.catalogue.slots(m.id)).map((s) => [s.label, s.days, s.position])).toEqual([
        ['Dinner', ['mon', 'tue'], 0],
        [null, ['sun'], 1],
      ]);

      const media = await r.catalogue.transaction((tx) =>
        tx.createMedia({ merchantId: m.id, purpose: 'item', status: 'uploading', contentType: 'image/png', originalKey: `o/${uniq()}`, uploadedBy: null }),
      );
      const variants = { thumb: { key: 't', width: 320, height: 320, bytes: 100 }, medium: { key: 'm', width: 960, height: 720, bytes: 900 } };
      await r.catalogue.transaction((tx) => tx.updateMedia(media.id, { status: 'pending_review', variants }));
      expect(await r.catalogue.getMedia(media.id)).toMatchObject({ status: 'pending_review', variants, purpose: 'item' });
      expect((await r.catalogue.listMedia({ merchantId: m.id, status: 'pending_review', limit: 5 })).map((x) => x.id)).toEqual([media.id]);
      expect((await r.catalogue.mediaByIds([media.id, randomUUID()])).map((x) => x.id)).toEqual([media.id]);
    });

    it('merchant photo ids round-trip (uuid[])', async () => {
      const r = await make();
      const m = await merchant(r);
      const ids = [randomUUID(), randomUUID()];
      expect((await r.merchants.transaction((tx) => tx.update(m.id, { photoIds: ids }))).photoIds).toEqual(ids);
      expect((await r.merchants.get(m.id))!.photoIds).toEqual(ids);
    });
  });
}
