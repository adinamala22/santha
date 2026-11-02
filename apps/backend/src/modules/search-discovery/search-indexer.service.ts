import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import { type Env, workersEnabled } from '../../config/env';
import type { DomainEvent } from '../../infra/outbox/domain-event';
import { EventBus } from '../../infra/outbox/event-bus';
import { CatalogueService } from '../merchant-catalogue/catalogue.service';
import { categoryBySlug } from '../merchant-catalogue/domain/taxonomy';
import type { ItemDoc, MerchantDoc } from './domain/documents';
import { SearchIndex } from './search-index';

/** Events after which a merchant's documents are rebuilt. Every payload carries merchant_id. */
export const INDEXED_EVENTS = [
  'merchant.went_live',
  'merchant.updated',
  'merchant.catalogue_confirmed',
  'merchant.slots_updated',
  'merchant.availability_changed',
  'merchant.auto_paused',
  'item.created',
  'item.updated',
  'item.price_changed',
  'item.stock_changed',
  'item.deleted',
  'item.approved',
  'item.released',
  'item.rejected',
  'merchant.catalogue_went_stale',
  'media.approved',
  'media.rejected',
] as const;

type Snapshot = NonNullable<Awaited<ReturnType<CatalogueService['indexSnapshot']>>>;

/** Builds the search documents for one live merchant from the catalogue's snapshot. */
export function buildDocs(s: Snapshot): { merchant: MerchantDoc; items: ItemDoc[] } | null {
  const m = s.merchant;
  if (m.status !== 'live' || !m.microMarketId || !m.location) return null;
  const items: ItemDoc[] = s.items.map((v) => {
    const i = v.item;
    const available = i.variants.filter((x) => x.stock !== 'out');
    const cheapest = [...(available.length ? available : i.variants)].sort((a, b) => a.pricePaise - b.pricePaise)[0]!;
    const cat = categoryBySlug(i.categorySlug);
    return {
      id: i.id,
      merchantId: m.id,
      microMarketId: m.microMarketId!,
      merchantName: m.name,
      merchantType: m.type,
      name: i.name,
      nameTe: i.nameTe,
      brand: i.brand,
      categorySlug: i.categorySlug,
      categoryName: cat?.name ?? i.categorySlug,
      categoryNameTe: cat?.nameTe ?? '',
      foodMark: i.foodMark,
      inStock: v.stock !== 'out',
      stale: v.stale,
      pricePaise: cheapest.pricePaise,
      mrpPaise: cheapest.mrpPaise,
      variantId: cheapest.id,
      variantLabel: cheapest.label,
      variantCount: i.variants.length,
      imageUrl: v.imageUrl,
      madeToOrder: i.madeToOrder,
      specialOn: i.specialOn,
      location: m.location!,
    };
  });
  const updated = Math.max(m.liveAt?.getTime() ?? 0, ...s.items.map((v) => Math.max(v.item.updatedAt.getTime(), v.item.confirmedAt.getTime())));
  return {
    merchant: {
      id: m.id,
      microMarketId: m.microMarketId,
      name: m.name,
      nameTe: m.nameTe,
      type: m.type,
      category: m.category,
      description: m.description,
      location: m.location,
      radiusM: m.radiusM,
      hours: m.hours,
      acceptingOrders: m.acceptingOrders,
      selfDelivers: m.defaultFulfilment === 'self',
      photoUrl: s.photos[0]?.mediumUrl ?? null,
      hasSlots: s.hasSlots,
      itemCount: items.length,
      staleItemCount: items.filter((i) => i.stale).length,
      catalogueUpdatedAt: updated,
      movPaise: m.movPaise,
      hygieneDeclared: !!m.hygieneDeclaredAt,
      fssaiVerified: s.fssaiVerified,
      returnPolicy: m.returnPolicy,
      rating: null,
      ratingCount: 0,
      acceptanceRate: null,
      prepP50Min: null,
    },
    items,
  };
}

/**
 * Keeps the search index in step with the catalogue by consuming merchant/item/media events
 * (outbox → BullMQ with Postgres; in-process in fake mode). Rebuilds the index at boot (fake mode,
 * and the worker process with Postgres); `pnpm --filter backend search:reindex` does it on demand.
 */
@Injectable()
export class SearchIndexer implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(SearchIndexer.name);

  constructor(
    private readonly bus: EventBus,
    private readonly index: SearchIndex,
    private readonly catalogue: CatalogueService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    for (const type of INDEXED_EVENTS) this.bus.on(type, 'search-indexer', (e) => this.onEvent(e));
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.index.ensure();
      // Fake mode always (the index lives in memory). With Postgres, the worker process rebuilds at
      // boot so a missed event can never leave the index stale for long; API-only processes skip it.
      if (this.index.engine === 'memory' || workersEnabled(this.env)) await this.reindexAll();
    } catch (err) {
      // Search being down must not stop ordering (tech plan 4.4: graceful degradation).
      this.logger.error(`search index unavailable at boot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async onEvent(e: DomainEvent): Promise<void> {
    const merchantId = (e.payload as { merchant_id?: unknown }).merchant_id;
    if (typeof merchantId === 'string') await this.reindexMerchant(merchantId);
  }

  async reindexMerchant(merchantId: string): Promise<void> {
    const snap = await this.catalogue.indexSnapshot(merchantId);
    const docs = snap ? buildDocs(snap) : null;
    if (docs) await this.index.replaceMerchant(docs.merchant, docs.items);
    else await this.index.removeMerchant(merchantId);
  }

  async reindexAll(): Promise<{ merchants: number; items: number }> {
    const started = Date.now();
    const live = await this.catalogue.liveMerchantIds();
    for (const id of live) await this.reindexMerchant(id);
    const counts = await this.index.counts();
    this.logger.log(`search index (${this.index.engine}) rebuilt: ${counts.merchants} stores, ${counts.items} items in ${Date.now() - started} ms`);
    return counts;
  }
}
