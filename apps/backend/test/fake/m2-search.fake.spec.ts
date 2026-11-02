/**
 * M2 acceptance (fake mode): discovery. "Home feed shows seeded stores with ETA chips" and
 * "search p95 < 400 ms locally with 20k items", plus grouping by store, Telugu transliteration
 * and synonyms, typo tolerance, delivery radius, closed-store ordering and ranking weights from
 * the micro-market config.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS, SEED_OUTSIDE_POINT } from '../../src/dev/seed-data';
import type { ItemDoc, MerchantDoc } from '../../src/modules/search-discovery/domain/documents';
import { SearchIndex } from '../../src/modules/search-discovery/search-index';
import { bootFakeApp, type FakeApp } from './harness';

const centre = (slug: string) => SEED_MICRO_MARKETS.find((m) => m.slug === slug)!.centre;
const q = (p: { lat: number; lng: number }) => `lat=${p.lat}&lng=${p.lng}`;
const live = SEED_MERCHANTS.filter((m) => m.status === 'live');

interface Card {
  id: string;
  name: string;
  type: string;
  open: boolean;
  nextOpenAt: string | null;
  distanceM: number;
  score: number;
  eta: { mode: 'asap'; minMin: number; maxMin: number } | { mode: 'scheduled'; nextSlot: unknown };
}
interface SearchBody {
  groups: Array<{ store: Card; items: Array<{ name: string; nameTe: string | null }> }>;
  stores: Card[];
  zeroResult: boolean;
  totalItems: number;
}

describe('M2 · feed and search (fake mode)', () => {
  let fake: FakeApp;
  const http = () => fake.http();
  const search = async (where: string, text: string, extra = ''): Promise<SearchBody> =>
    (await http().get(`/v1/search?${q(centre(where))}&q=${encodeURIComponent(text)}${extra}`).expect(200)).body;
  const storesOf = (b: SearchBody) => b.groups.map((g) => g.store.name);
  const itemsOf = (b: SearchBody) => b.groups.flatMap((g) => g.items.map((i) => i.name));

  beforeAll(async () => {
    fake = await bootFakeApp();
  }, 60_000);
  afterAll(() => fake?.close());

  // ───── acceptance: home feed with ETA chips ─────

  it('ACCEPTANCE: the home feed shows the seeded live stores of each micro-market with ETA chips', async () => {
    const seen = new Set<string>();
    for (const m of SEED_MICRO_MARKETS) {
      for (const tab of ['stores', 'fashion', 'home_kitchens', 'home_businesses']) {
        const r = await http().get(`/v1/feed?${q(m.centre)}&tab=${tab}`).expect(200);
        expect(r.body.serviceability).toMatchObject({ serviceable: true, microMarket: { slug: m.slug } });
        for (const s of r.body.stores as Card[]) {
          seen.add(s.name);
          if (s.eta.mode === 'asap') {
            expect(s.eta.minMin).toBeGreaterThanOrEqual(5);
            expect(s.eta.maxMin - s.eta.minMin).toBe(10); // ETA ± 5 (discovery.etaRangeMin)
            expect(s.eta.maxMin).toBeLessThanOrEqual(75);
          } else expect(s.type).toBe('home_kitchen'); // kitchens with slots say "Scheduled"
        }
      }
    }
    expect([...seen].sort()).toEqual(live.map((m) => m.name).sort());
    // Submitted and draft stores never appear.
    for (const m of SEED_MERCHANTS.filter((x) => x.status !== 'live')) expect(seen.has(m.name)).toBe(false);
  });

  it('tabs carry counts; a kitchen shows its next open slot', async () => {
    const r = await http().get(`/v1/feed?${q(centre('dargamitta'))}&tab=home_kitchens`).expect(200);
    expect(r.body.tabs).toEqual([
      { key: 'stores', count: 1 },
      { key: 'fashion', count: 0 },
      { key: 'home_kitchens', count: 1 },
      { key: 'home_businesses', count: 0 },
    ]);
    const k = r.body.stores[0];
    expect(k).toMatchObject({ name: "Saraswathi's Kitchen", eta: { mode: 'scheduled', nextSlot: { start: expect.stringMatching(/^\d\d:\d\d$/) } } });
  });

  it('outside every micro-market: not serviceable', async () => {
    const r = await http().get(`/v1/feed?${q(SEED_OUTSIDE_POINT)}`).expect(200);
    expect(r.body).toMatchObject({ serviceability: { serviceable: false, microMarket: null }, stores: [] });
    const s = await http().get(`/v1/search?${q(SEED_OUTSIDE_POINT)}&q=rice`).expect(200);
    expect(s.body).toMatchObject({ zeroResult: true, groups: [] });
  });

  it('stores beyond their delivery radius are hidden (FR-LOC-4)', async () => {
    const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
    const owner = await fake.signIn(kirana.ownerPhone, 'merchant');
    const far = { lat: centre('dargamitta').lat - 0.006, lng: centre('dargamitta').lng + 0.006 };
    const names = async () => ((await http().get(`/v1/feed?${q(far)}`).expect(200)).body.stores as Card[]).map((s) => s.name);
    expect(await names()).toContain('Ramesh Stores');
    await http().patch('/v1/merchants/me').set(owner.headers).send({ radiusM: 500 }).expect(200);
    expect(await names()).not.toContain('Ramesh Stores'); // reindexed from merchant.updated
    await http().patch('/v1/merchants/me').set(owner.headers).send({ radiusM: 3000 }).expect(200);
    expect(await names()).toContain('Ramesh Stores');
  });

  // ───── search ─────

  it('results are grouped by store with prices; only stores in this micro-market', async () => {
    const r = await search('balaji-nagar', 'tomato');
    expect(storesOf(r).sort()).toEqual(["Amma's Pickles", 'Balaji Fruits & Vegetables']);
    const fv = r.groups.find((g) => g.store.name === 'Balaji Fruits & Vegetables')!;
    expect(fv.items[0]).toMatchObject({ name: 'Tomato', nameTe: 'టమాటా', pricePaise: 1800 });
    expect(fv.store.eta.mode).toBe('asap');
  });

  it('Telugu transliteration and synonyms: biyyam → rice, pappu → dal, atta ↔ wheat flour', async () => {
    expect(itemsOf(await search('dargamitta', 'biyyam'))).toContain('Annapoorna Sona Masoori Rice');
    expect(itemsOf(await search('dargamitta', 'pappu'))).toEqual(expect.arrayContaining(['Annapoorna Toor Dal', 'Annapoorna Moong Dal']));
    expect(itemsOf(await search('dargamitta', 'wheat flour'))[0]).toBe('Annapoorna Chakki Atta');
    expect(itemsOf(await search('balaji-nagar', 'ullipayalu'))).toContain('Onion');
  });

  it('Telugu script queries match Telugu names', async () => {
    expect(itemsOf(await search('balaji-nagar', 'ఉల్లిపాయలు'))).toContain('Onion');
    expect(itemsOf(await search('dargamitta', 'బియ్యం'))).toContain('Annapoorna Sona Masoori Rice');
    expect(itemsOf(await search('balaji-nagar', 'గోంగూర'))).toEqual(expect.arrayContaining(['Gongura', 'Gongura Pickle']));
  });

  it('typo tolerance and prefixes', async () => {
    expect(itemsOf(await search('balaji-nagar', 'tomoto'))).toContain('Tomato');
    expect(itemsOf(await search('dargamitta', 'masori'))).toContain('Annapoorna Sona Masoori Rice');
    expect(itemsOf(await search('dargamitta', 'sunfl'))).toContain('Swarna Dhara Sunflower Oil');
  });

  it('store names match too; veg filter drops non-veg items', async () => {
    const r = await search('dargamitta', 'saraswathi');
    expect(r.stores.map((s) => s.name)).toEqual(["Saraswathi's Kitchen"]);
    const all = itemsOf(await search('dargamitta', 'curry'));
    const veg = itemsOf(await search('dargamitta', 'curry', '&veg=true'));
    expect(all).toContain('Kodi Kura with Rice');
    expect(veg).not.toContain('Kodi Kura with Rice');
  });

  it('a query with no matches reports zeroResult', async () => {
    expect(await search('dargamitta', 'xylophone')).toMatchObject({ zeroResult: true, groups: [], totalItems: 0 });
  });

  // ───── ranking + scale (synthetic stores in the index) ─────

  describe('with 20,000 items indexed', () => {
    const mm = centre('magunta-layout');
    let microMarketId: string;
    const N_STORES = 100;
    const PER_STORE = 200;

    beforeAll(async () => {
      const feed = await http().get(`/v1/feed?${q(mm)}`).expect(200);
      microMarketId = feed.body.serviceability.microMarket.id;
      const index = fake.app.get(SearchIndex);
      const brands = ['Annapoorna', 'Godavari Gold', 'Penna Valley', 'Krishna', 'Swarna', 'Kaveri', 'Nellore Fresh', 'Sri Venkateswara'];
      const products = ['Sona Masoori Rice', 'Chakki Atta', 'Toor Dal', 'Moong Dal', 'Sunflower Oil', 'Groundnut Oil', 'Turmeric Powder', 'Red Chilli Powder', 'Toned Milk', 'Curd', 'Paneer', 'Tea Powder', 'Filter Coffee', 'Glucose Biscuits', 'Potato Chips', 'Detergent Powder', 'Bath Soap', 'Shampoo', 'Toothpaste', 'Agarbatti', 'Jaggery', 'Sugar', 'Iodised Salt', 'Tamarind', 'Poha'];
      const packs = ['100 g', '200 g', '500 g', '1 kg', '5 kg', '500 ml', '1 l'];
      for (let s = 0; s < N_STORES; s++) {
        const id = `99999999-0000-4000-8000-${String(s).padStart(12, '0')}`;
        const loc = { lat: mm.lat + ((s % 10) - 5) * 0.0012, lng: mm.lng + (Math.floor(s / 10) - 5) * 0.0012 };
        const merchant: MerchantDoc = {
          id,
          microMarketId,
          name: `Synthetic Store ${s}`,
          nameTe: null,
          type: 'retail',
          category: 'kirana',
          description: null,
          location: loc,
          radiusM: 5000,
          hours: everyDay('00:00', '23:59'),
          selfDelivers: s % 2 === 0,
          photoUrl: null,
          hasSlots: false,
          itemCount: PER_STORE,
          staleItemCount: 0,
          catalogueUpdatedAt: Date.now(),
          movPaise: 0,
          hygieneDeclared: false,
          fssaiVerified: false,
          returnPolicy: null,
          rating: 3 + ((s * 7) % 21) / 10, // 3.0 … 5.0, not in distance order
          ratingCount: 10,
          acceptanceRate: 0.9,
          prepP50Min: null,
        };
        const items: ItemDoc[] = Array.from({ length: PER_STORE }, (_, k) => {
          const brand = brands[(s + k) % brands.length]!;
          const product = products[k % products.length]!;
          const pack = packs[(k + s) % packs.length]!;
          return {
            id: `99999999-1111-4000-8000-${String(s * PER_STORE + k).padStart(12, '0')}`,
            merchantId: id,
            microMarketId,
            merchantName: merchant.name,
            merchantType: 'retail',
            name: `${brand} ${product} ${pack}`,
            nameTe: null,
            brand,
            categorySlug: 'staples',
            categoryName: 'Atta, rice & dal',
            categoryNameTe: 'అట్టా, బియ్యం & పప్పులు',
            foodMark: 'veg',
            inStock: k % 13 !== 0,
            stale: k % 29 === 0,
            pricePaise: 1000 + k * 10,
            mrpPaise: 1200 + k * 10,
            variantId: '00000000-0000-4000-8000-000000000000',
            variantLabel: pack,
            variantCount: 1,
            imageUrl: null,
            madeToOrder: false,
            specialOn: null,
            location: loc,
          };
        });
        await index.replaceMerchant(merchant, items);
      }
      expect((await index.counts()).items).toBeGreaterThanOrEqual(N_STORES * PER_STORE);
    }, 120_000);

    it('ACCEPTANCE: search p95 < 400 ms with 20k items (HTTP, fake mode)', async () => {
      const queries = ['rice', 'biyyam', 'atta', 'toor dal', 'pappu', 'sunflower oil', 'nune', 'milk', 'paalu', 'curd', 'perugu', 'tea', 'chai', 'biscuits', 'chips', 'soap', 'shampoo', 'masori', 'tumeric', 'groundnut', 'godavari', 'krishna sugar', 'salt', 'uppu', 'tamarind', 'chintapandu', 'jaggery 1 kg', 'poha', 'coffee', 'paneer'];
      const times: number[] = [];
      for (let round = 0; round < 5; round++)
        for (const text of queries) {
          const t0 = performance.now();
          const r = await http().get(`/v1/search?${q(mm)}&q=${encodeURIComponent(text)}`).expect(200);
          times.push(performance.now() - t0);
          expect(r.body.zeroResult).toBe(false);
        }
      times.sort((a, b) => a - b);
      const p95 = times[Math.floor(times.length * 0.95)]!;
      console.log(`search over 20k items: p50 ${times[Math.floor(times.length / 2)]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (${times.length} queries)`);
      expect(p95).toBeLessThan(400);
    }, 120_000);

    it('closed stores are listed last; open ones by score', async () => {
      const stores: Card[] = (await http().get(`/v1/feed?${q(mm)}`).expect(200)).body.stores;
      const firstClosed = stores.findIndex((s) => !s.open);
      if (firstClosed >= 0) expect(stores.slice(firstClosed).every((s) => !s.open)).toBe(true);
      const open = stores.filter((s) => s.open);
      for (let i = 1; i < open.length; i++) expect(open[i - 1]!.score).toBeGreaterThanOrEqual(open[i]!.score);
    });

    it('ranking weights come from the micro-market config (a new version re-ranks at once)', async () => {
      const ops = await fake.opsSignIn();
      const feedOrder = async () => ((await http().get(`/v1/feed?${q(mm)}`).expect(200)).body.stores as Card[]).filter((s) => s.name.startsWith('Synthetic')).map((s) => s.name);
      const publish = async (weights: Record<string, number>) => {
        const d = (await http().get(`/v1/ops/micro-markets/${microMarketId}`).set(ops.headers).expect(200)).body.current;
        await http()
          .post(`/v1/ops/micro-markets/${microMarketId}/versions`)
          .set(ops.headers)
          .send({ config: { polygon: d.polygon, hours: d.hours, fees: d.fees, cod: d.cod, sla: d.sla, riderPay: d.riderPay, discovery: { ...d.discovery, weights } }, note: 'ranking test' })
          .expect(201);
      };
      await publish({ distance: 1, eta: 0, rating: 0, acceptance: 0, freshness: 0 });
      const byDistance = await feedOrder();
      const cards: Card[] = (await http().get(`/v1/feed?${q(mm)}`).expect(200)).body.stores.filter((s: Card) => s.name.startsWith('Synthetic'));
      for (let i = 1; i < cards.length; i++) expect(cards[i - 1]!.distanceM).toBeLessThanOrEqual(cards[i]!.distanceM + 1);

      await publish({ distance: 0, eta: 0, rating: 1, acceptance: 0, freshness: 0 });
      const byRating = await feedOrder();
      expect(byRating).not.toEqual(byDistance);
      expect(byRating[0]).toBe('Synthetic Store 2'); // rating 4.4 … highest ratings first
    });
  });
});
