import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { haversineMeters, type LatLng } from '../../common/geo/polygon';
import { istParts, openStatus } from '../../common/hours';
import { DomainError } from '../../common/errors/domain-error';
import { categoryBySlug, categoryRank } from '../merchant-catalogue/domain/taxonomy';
import { buildDocs } from './search-indexer.service';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { CatalogueService } from '../merchant-catalogue/catalogue.service';
import type { ItemDoc, MerchantDoc } from './domain/documents';
import { rankStore, STALE_ITEM_FACTOR } from './domain/ranking';
import { searchHints } from './domain/synonyms';
import { EtaService } from './eta.service';
import { SearchIndex } from './search-index';
import { StoreRatings } from './store-ratings';

export const TABS = { stores: 'retail', fashion: 'fashion', home_kitchens: 'home_kitchen', home_businesses: 'home_business' } as const;
export type Tab = keyof typeof TABS;

export interface Filters {
  openNow?: boolean | undefined;
  vegOnly?: boolean | undefined;
  selfDelivered?: boolean | undefined;
  maxEtaMin?: number | undefined;
  /** Only stores rated at least this (PRD filter "rating 4+"); unrated stores are left out. */
  minRating?: number | undefined;
}

export interface StoreCard {
  id: string;
  name: string;
  nameTe: string | null;
  type: MerchantDoc['type'];
  category: string | null;
  photoUrl: string | null;
  distanceM: number;
  /** ASAP stores: ETA range; scheduled-only kitchens: mode "scheduled" with the next open slot. */
  eta: { mode: 'asap'; minMin: number; maxMin: number } | { mode: 'scheduled'; nextSlot: { date: string; start: string; end: string; cutoffAt: Date } | null };
  open: boolean;
  nextOpenAt: Date | null;
  closesAt: Date | null;
  selfDelivers: boolean;
  hygieneDeclared: boolean;
  rating: number | null;
  ratingCount: number;
  movPaise: number;
  itemCount: number;
  score: number;
}

export interface ItemCard {
  id: string;
  merchantId: string;
  variantId: string;
  variantLabel: string;
  name: string;
  nameTe: string | null;
  brand: string | null;
  categorySlug: string;
  pricePaise: number;
  mrpPaise: number | null;
  foodMark: ItemDoc['foodMark'];
  imageUrl: string | null;
  variantCount: number;
  stale: boolean;
  madeToOrder: boolean;
}

interface Market {
  id: string;
  slug: string;
  name: string;
  nameTe: string;
}

export type Serviceability = { serviceable: false; microMarket: null } | { serviceable: true; microMarket: Market };

type VersionRecord = NonNullable<Awaited<ReturnType<MicroMarketsService['effective']>>>;

const ITEMS_PER_GROUP = 4;
const MAX_GROUPS = 30;

/**
 * search-discovery (M2): home feed by supply type (FR-DIS-1) and unified search grouped by store
 * (FR-DIS-2), both inside the customer's micro-market and each store's delivery radius
 * (FR-LOC-4), with ETA chips (FR-LOC-3) and ranking weights from the micro-market config.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly index: SearchIndex,
    private readonly markets: MicroMarketsService,
    private readonly eta: EtaService,
    private readonly catalogue: CatalogueService,
    private readonly ratings: StoreRatings,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async locate(pt: LatLng): Promise<{ market: Market; version: VersionRecord } | null> {
    const hit = await this.markets.resolve(pt, this.clock());
    return hit ? { market: { id: hit.market.id, slug: hit.market.slug, name: hit.market.name, nameTe: hit.market.nameTe }, version: hit.version } : null;
  }

  /** Store cards for the docs that deliver to `pt` (inside their radius). */
  private async cards(docs: MerchantDoc[], pt: LatLng, version: VersionRecord): Promise<StoreCard[]> {
    const now = this.clock();
    const d = version.discovery;
    const out = await Promise.all(
      docs.map(async (doc): Promise<StoreCard | null> => {
        const straight = haversineMeters(doc.location, pt);
        if (straight > doc.radiusM) return null;
        const hours = doc.acceptingOrders === false ? { open: false, nextOpenAt: null, closesAt: null } : openStatus(doc.hours, now);
        let eta: StoreCard['eta'];
        let etaMin: number | null = null;
        if (doc.type === 'home_kitchen' && doc.hasSlots) {
          const { nextOpen } = await this.catalogue.slotAvailability(doc.id, 2);
          eta = { mode: 'scheduled', nextSlot: nextOpen ? { date: nextOpen.date, start: nextOpen.start, end: nextOpen.end, cutoffAt: nextOpen.cutoffAt } : null };
        } else {
          const e = await this.eta.estimate(doc, pt, d, version.sla.etaBufferMin);
          etaMin = e.etaMin;
          eta = { mode: 'asap', minMin: e.minMin, maxMin: e.maxMin };
        }
        const { score } = rankStore({ doc, distanceM: straight, etaMin, now, staleHours: version.sla.staleCatalogueHours }, d);
        return {
          id: doc.id,
          name: doc.name,
          nameTe: doc.nameTe,
          type: doc.type,
          category: doc.category,
          photoUrl: doc.photoUrl,
          distanceM: Math.round(straight),
          eta,
          open: hours.open,
          nextOpenAt: hours.nextOpenAt,
          closesAt: hours.closesAt,
          selfDelivers: doc.selfDelivers,
          hygieneDeclared: doc.hygieneDeclared,
          rating: doc.rating,
          ratingCount: doc.ratingCount,
          movPaise: doc.movPaise,
          itemCount: doc.itemCount,
          score,
        };
      }),
    );
    return out.filter((c): c is StoreCard => c !== null);
  }

  private passes(c: StoreCard, f: Filters): boolean {
    if (f.openNow && !c.open) return false;
    if (f.selfDelivered && !c.selfDelivers) return false;
    if (f.maxEtaMin != null && (c.eta.mode !== 'asap' || c.eta.maxMin > f.maxEtaMin)) return false;
    if (f.minRating != null && (c.rating == null || c.rating < f.minRating)) return false;
    return true;
  }

  private static order(a: StoreCard, b: StoreCard): number {
    return orderStores(a, b);
  }

  async feed(pt: LatLng, tab: Tab, f: Filters) {
    const loc = await this.locate(pt);
    if (!loc) return { serviceability: { serviceable: false, microMarket: null } as Serviceability, tab, tabs: [], stores: [] as StoreCard[] };
    const all = await this.cards(await this.index.merchantsIn(loc.market.id), pt, loc.version);
    const tabs = (Object.keys(TABS) as Tab[]).map((key) => ({ key, count: all.filter((c) => c.type === TABS[key] && this.passes(c, f)).length }));
    const stores = all.filter((c) => c.type === TABS[tab] && this.passes(c, f)).sort(DiscoveryService.order);
    return { serviceability: { serviceable: true, microMarket: loc.market } as Serviceability, tab, tabs, stores };
  }

  async search(q: string, pt: LatLng, f: Filters, categorySlug?: string) {
    const started = performance.now();
    const loc = await this.locate(pt);
    if (!loc) return { serviceability: { serviceable: false, microMarket: null } as Serviceability, query: q, hints: [], groups: [], stores: [], totalItems: 0, zeroResult: true, tookMs: 0 };
    const [itemHits, storeHits, docs] = await Promise.all([
      this.index.searchItems({ q, microMarketId: loc.market.id, inStockOnly: true, vegOnly: f.vegOnly, categorySlug, limit: 250 }),
      q.trim() ? this.index.searchMerchants(q, loc.market.id, 10) : Promise.resolve([]),
      this.index.merchantsIn(loc.market.id),
    ]);
    const cards = new Map((await this.cards(docs, pt, loc.version)).filter((c) => this.passes(c, f)).map((c) => [c.id, c]));
    const tw = loc.version.discovery.textWeight;

    const byStore = new Map<string, Array<{ doc: ItemDoc; text: number }>>();
    for (const h of itemHits) {
      if (!cards.has(h.doc.merchantId)) continue; // outside radius or filtered
      const text = h.doc.stale ? h.text * STALE_ITEM_FACTOR : h.text;
      const list = byStore.get(h.doc.merchantId) ?? [];
      list.push({ doc: h.doc, text });
      byStore.set(h.doc.merchantId, list);
    }
    const groups = [...byStore.entries()]
      .map(([id, hits]) => {
        hits.sort((a, b) => b.text - a.text || a.doc.pricePaise - b.doc.pricePaise);
        const store = cards.get(id)!;
        return { store, score: tw * hits[0]!.text + (1 - tw) * store.score, items: hits.slice(0, ITEMS_PER_GROUP).map((h) => this.itemCard(h.doc)), more: Math.max(0, hits.length - ITEMS_PER_GROUP) };
      })
      .sort((a, b) => (a.store.open !== b.store.open ? (a.store.open ? -1 : 1) : b.score - a.score))
      .slice(0, MAX_GROUPS);
    const stores = storeHits.map((h) => cards.get(h.doc.id)).filter((c): c is StoreCard => !!c);
    const totalItems = [...byStore.values()].reduce((n, l) => n + l.length, 0);
    const tookMs = Math.round(performance.now() - started);
    this.logger.debug(`search "${q}" → ${groups.length} stores, ${totalItems} items in ${tookMs} ms`);
    return { serviceability: { serviceable: true, microMarket: loc.market } as Serviceability, query: q, hints: searchHints(q), groups, stores, totalItems, zeroResult: groups.length === 0 && stores.length === 0, tookMs };
  }

  /**
   * Store / home-kitchen page (FR-DIS-5, FR-CAT-5): trust row, delivery info, categories, every
   * sellable item with its sizes, and (kitchens) today's slots with cut-offs. Read straight from
   * the catalogue so prices and stock are current; the app caches it for offline use.
   */
  async store(id: string, pt: LatLng) {
    const snap = await this.catalogue.indexSnapshot(id);
    const docs = snap ? buildDocs(snap, await this.ratings.get(id)) : null;
    if (!snap || !docs) throw new DomainError('NOT_FOUND', 'This store is not on Santha right now.');
    const loc = await this.locate(pt);
    const version = loc?.version ?? (await this.markets.effective(docs.merchant.microMarketId, this.clock()));
    if (!version) throw new DomainError('NOT_FOUND', 'This store is not on Santha right now.');
    const [card] = await this.cards([docs.merchant], docs.merchant.location, version); // ETA etc. from the store itself…
    const straight = haversineMeters(docs.merchant.location, pt);
    const eta = await this.eta.estimate(docs.merchant, pt, version.discovery, version.sla.etaBufferMin); // …then for this customer
    const store: StoreCard = {
      ...card!,
      distanceM: Math.round(straight),
      eta: card!.eta.mode === 'scheduled' ? card!.eta : { mode: 'asap', minMin: eta.minMin, maxMin: eta.maxMin },
    };
    const today = istParts(this.clock());
    const items = snap.items.map((v) => {
      const i = v.item;
      return {
        ...this.itemCard(docs.items.find((d) => d.id === i.id)!),
        description: i.description,
        allergens: i.allergens,
        leadTimeMin: i.leadTimeMin,
        maxPerOrder: i.maxPerOrder,
        stock: v.stock,
        variants: i.variants.map((x) => ({ id: x.id, label: x.label, pricePaise: x.pricePaise, mrpPaise: x.mrpPaise, stock: x.stock })),
        onMenuToday: i.availableDays.length === 0 || i.availableDays.includes(today.day),
        dailyCapacity: i.dailyCapacity,
        special: i.specialOn === today.date,
      };
    });
    items.sort((a, b) => categoryRank(a.categorySlug) - categoryRank(b.categorySlug) || a.name.localeCompare(b.name)); // aisle order
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.categorySlug, (counts.get(it.categorySlug) ?? 0) + 1);
    const categories = [...counts].map(([slug, count]) => {
      const c = categoryBySlug(slug);
      return { slug, name: c?.name ?? slug, nameTe: c?.nameTe ?? slug, count };
    });
    const slots = docs.merchant.hasSlots ? await this.catalogue.slotAvailability(id, 2) : null;
    return {
      store,
      description: docs.merchant.description,
      microMarket: loc?.market ?? null,
      deliversHere: straight <= docs.merchant.radiusM && loc?.market.id === docs.merchant.microMarketId,
      deliveryRadiusM: docs.merchant.radiusM,
      // Why not (ADR-019): the customer is in no served area, in another area, or beyond the store's radius.
      notDeliveringReason: !loc
        ? ('outside_service_area' as const)
        : loc.market.id !== docs.merchant.microMarketId
          ? ('other_area' as const)
          : straight > docs.merchant.radiusM
            ? ('too_far' as const)
            : null,
      photos: snap.photos.map((p) => ({ thumbUrl: p.thumbUrl, mediumUrl: p.mediumUrl })),
      fssaiVerified: docs.merchant.fssaiVerified,
      hygieneDeclared: docs.merchant.hygieneDeclared,
      returnPolicy: docs.merchant.returnPolicy,
      freeDeliveryAbovePaise: version.fees.freeDeliveryAbovePaise,
      categories,
      items,
      slots,
      generatedAt: this.clock(),
    };
  }

  private itemCard(d: ItemDoc): ItemCard {
    return {
      id: d.id,
      merchantId: d.merchantId,
      variantId: d.variantId,
      variantLabel: d.variantLabel,
      name: d.name,
      nameTe: d.nameTe,
      brand: d.brand,
      categorySlug: d.categorySlug,
      pricePaise: d.pricePaise,
      mrpPaise: d.mrpPaise,
      foodMark: d.foodMark,
      imageUrl: d.imageUrl,
      variantCount: d.variantCount,
      stale: d.stale,
      madeToOrder: d.madeToOrder,
    };
  }
}

/** Next slot as a sortable local key ("2026-11-03T12:30"); null = no open slot; undefined = not scheduled. */
const slotKey = (c: StoreCard): string | null | undefined =>
  c.eta.mode === 'scheduled' ? (c.eta.nextSlot ? `${c.eta.nextSlot.date}T${c.eta.nextSlot.start}` : null) : undefined;

/**
 * Feed order (FR-DIS-1). Kitchens that sell by slot: soonest open slot first, those with no open
 * slot last. Otherwise open stores by score, closed ones after, soonest to open first.
 */
export function orderStores(a: StoreCard, b: StoreCard): number {
  const sa = slotKey(a);
  const sb = slotKey(b);
  if (sa !== undefined && sb !== undefined) {
    if (sa === null || sb === null) return sa === sb ? b.score - a.score : sa === null ? 1 : -1;
    return sa.localeCompare(sb) || b.score - a.score || a.id.localeCompare(b.id);
  }
  if (a.open !== b.open) return a.open ? -1 : 1;
  if (!a.open) return (a.nextOpenAt?.getTime() ?? Infinity) - (b.nextOpenAt?.getTime() ?? Infinity) || b.score - a.score;
  return b.score - a.score || a.id.localeCompare(b.id);
}
