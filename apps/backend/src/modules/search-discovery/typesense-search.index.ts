import { Logger } from '@nestjs/common';
import { Client } from 'typesense';
import type { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections';
import type { Env } from '../../config/env';
import type { ItemDoc, MerchantDoc } from './domain/documents';
import { SYNONYM_GROUPS } from './domain/synonyms';
import { type Hit, type ItemSearch, SearchIndex } from './search-index';

/** Flattened Typesense document shapes (geopoints are [lat, lng]; nested objects as JSON strings). */
interface TsItem extends Omit<ItemDoc, 'location' | 'nameTe' | 'brand' | 'foodMark' | 'mrpPaise' | 'imageUrl' | 'specialOn'> {
  location: [number, number];
  nameTe?: string;
  brand?: string;
  foodMark?: string;
  mrpPaise?: number;
  imageUrl?: string;
  specialOn?: string;
}
interface TsMerchant {
  id: string;
  microMarketId: string;
  name: string;
  nameTe?: string;
  category?: string;
  description?: string;
  location: [number, number];
  payload: string;
}

const optional = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

/**
 * Typesense engine (tech plan 4.2). Collections `<prefix>items` and `<prefix>merchants` with geo
 * fields, multi-way synonyms from SYNONYM_GROUPS, typo tolerance on. Results are post-processed by
 * DiscoveryService exactly like the in-memory engine's.
 */
export class TypesenseSearchIndex extends SearchIndex {
  readonly engine = 'typesense' as const;
  private readonly logger = new Logger('TypesenseSearchIndex');
  private readonly client: Client;
  private readonly itemsName: string;
  private readonly merchantsName: string;

  constructor(env: Env) {
    super();
    this.client = new Client({
      nodes: [{ host: env.TYPESENSE_HOST, port: env.TYPESENSE_PORT, protocol: env.TYPESENSE_PROTOCOL }],
      apiKey: env.TYPESENSE_API_KEY ?? '',
      connectionTimeoutSeconds: 5,
      retryIntervalSeconds: 0.2,
      numRetries: 2,
      logLevel: 'warn',
    });
    this.itemsName = `${env.TYPESENSE_PREFIX}items`;
    this.merchantsName = `${env.TYPESENSE_PREFIX}merchants`;
  }

  async ensure(): Promise<void> {
    const items: CollectionCreateSchema = {
      name: this.itemsName,
      fields: [
        { name: 'merchantId', type: 'string', facet: true },
        { name: 'microMarketId', type: 'string', facet: true },
        { name: 'merchantName', type: 'string' },
        { name: 'merchantType', type: 'string', facet: true },
        { name: 'name', type: 'string' },
        { name: 'nameTe', type: 'string', optional: true, locale: 'te' },
        { name: 'brand', type: 'string', optional: true },
        { name: 'categorySlug', type: 'string', facet: true },
        { name: 'categoryName', type: 'string' },
        { name: 'categoryNameTe', type: 'string', locale: 'te' },
        { name: 'foodMark', type: 'string', optional: true, facet: true },
        { name: 'inStock', type: 'bool' },
        { name: 'stale', type: 'bool' },
        { name: 'pricePaise', type: 'int32' },
        { name: 'location', type: 'geopoint' },
      ],
      // Everything else (mrpPaise, imageUrl, …) is stored but not indexed.
    };
    const merchants: CollectionCreateSchema = {
      name: this.merchantsName,
      fields: [
        { name: 'microMarketId', type: 'string', facet: true },
        { name: 'name', type: 'string' },
        { name: 'nameTe', type: 'string', optional: true, locale: 'te' },
        { name: 'category', type: 'string', optional: true },
        { name: 'description', type: 'string', optional: true },
        { name: 'location', type: 'geopoint' },
        { name: 'payload', type: 'string', index: false, optional: true },
      ],
    };
    for (const schema of [items, merchants]) {
      const exists = await this.client.collections(schema.name).exists();
      if (!exists) await this.client.collections().create(schema);
    }
    for (const name of [this.itemsName, this.merchantsName])
      await Promise.all(SYNONYM_GROUPS.map((g, i) => this.client.collections(name).synonyms().upsert(`g${i}`, { synonyms: [...g] })));
  }

  async replaceMerchant(merchant: MerchantDoc, items: ItemDoc[]): Promise<void> {
    await this.client.collections<TsMerchant>(this.merchantsName).documents().upsert(this.toTsMerchant(merchant));
    if (items.length) {
      const res = await this.client.collections<TsItem>(this.itemsName).documents().import(items.map((i) => this.toTsItem(i)), { action: 'upsert' });
      const failed = res.filter((r) => !r.success);
      if (failed.length) this.logger.warn(`${failed.length} item documents failed to index: ${failed[0]?.error ?? ''}`);
    }
    const keep = new Set(items.map((i) => i.id));
    // Remove items no longer sellable. Ids are fetched (not filtered by NOT IN) to keep filters short.
    const existing = await this.idsOfMerchant(merchant.id);
    const gone = existing.filter((id) => !keep.has(id));
    for (let k = 0; k < gone.length; k += 100)
      await this.client.collections(this.itemsName).documents().delete({ filter_by: `id:[${gone.slice(k, k + 100).join(',')}]` });
  }

  private async idsOfMerchant(merchantId: string): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; ; page++) {
      const r = await this.client.collections<TsItem>(this.itemsName).documents().search({ q: '*', filter_by: `merchantId:=${merchantId}`, include_fields: 'id', per_page: 250, page });
      ids.push(...(r.hits ?? []).map((h) => h.document.id));
      if (!r.hits || r.hits.length < 250) return ids;
    }
  }

  async removeMerchant(merchantId: string): Promise<void> {
    await this.client.collections(this.itemsName).documents().delete({ filter_by: `merchantId:=${merchantId}` });
    await this.client.collections(this.merchantsName).documents(merchantId).delete().catch(() => undefined);
  }

  async searchItems(s: ItemSearch): Promise<Hit<ItemDoc>[]> {
    const filters = [`microMarketId:=${s.microMarketId}`, s.inStockOnly ? 'inStock:=true' : null, s.vegOnly ? 'foodMark:=veg' : null, s.categorySlug ? `categorySlug:=${s.categorySlug}` : null].filter(Boolean).join(' && ');
    const r = await this.client.collections<TsItem>(this.itemsName).documents().search({
      q: s.q.trim() || '*',
      query_by: 'name,nameTe,brand,categoryName,categoryNameTe,merchantName',
      query_by_weights: '10,10,7,5,5,3',
      filter_by: filters,
      per_page: Math.min(s.limit, 250),
      prefix: 'true,true,true,false,false,false', // as-you-type on the last word, like the in-memory engine
      num_typos: 2,
      typo_tokens_threshold: 1,
      drop_tokens_threshold: 1,
      prioritize_exact_match: true,
    });
    const hits = r.hits ?? [];
    const max = Math.max(1, ...hits.map((h) => Number(h.text_match ?? 0)));
    return hits.map((h) => ({ doc: this.fromTsItem(h.document), text: Number(h.text_match ?? 0) / max }));
  }

  async searchMerchants(q: string, microMarketId: string, limit: number): Promise<Hit<MerchantDoc>[]> {
    const r = await this.client.collections<TsMerchant>(this.merchantsName).documents().search({
      q,
      query_by: 'name,nameTe,category,description',
      query_by_weights: '10,10,4,3',
      filter_by: `microMarketId:=${microMarketId}`,
      per_page: limit,
      num_typos: 2,
    });
    const hits = r.hits ?? [];
    const max = Math.max(1, ...hits.map((h) => Number(h.text_match ?? 0)));
    return hits.map((h) => ({ doc: JSON.parse(h.document.payload) as MerchantDoc, text: Number(h.text_match ?? 0) / max }));
  }

  async merchantsIn(microMarketId: string): Promise<MerchantDoc[]> {
    const out: MerchantDoc[] = [];
    for (let page = 1; ; page++) {
      const r = await this.client.collections<TsMerchant>(this.merchantsName).documents().search({ q: '*', filter_by: `microMarketId:=${microMarketId}`, per_page: 250, page });
      out.push(...(r.hits ?? []).map((h) => JSON.parse(h.document.payload) as MerchantDoc));
      if (!r.hits || r.hits.length < 250) return out;
    }
  }

  async counts(): Promise<{ items: number; merchants: number }> {
    const [i, m] = await Promise.all([this.client.collections(this.itemsName).retrieve(), this.client.collections(this.merchantsName).retrieve()]);
    return { items: i.num_documents, merchants: m.num_documents };
  }

  /** Test helper: drop both collections. */
  async drop(): Promise<void> {
    for (const n of [this.itemsName, this.merchantsName]) await this.client.collections(n).delete().catch(() => undefined);
  }

  private toTsItem(i: ItemDoc): TsItem {
    const { location, ...rest } = i;
    return optional({ ...rest, location: [location.lat, location.lng] }) as TsItem;
  }

  private fromTsItem(d: TsItem): ItemDoc {
    const { location, ...rest } = d;
    return {
      nameTe: null,
      brand: null,
      foodMark: null,
      mrpPaise: null,
      imageUrl: null,
      specialOn: null,
      ...rest,
      location: { lat: location[0], lng: location[1] },
    } as ItemDoc;
  }

  private toTsMerchant(m: MerchantDoc): TsMerchant {
    return optional({
      id: m.id,
      microMarketId: m.microMarketId,
      name: m.name,
      nameTe: m.nameTe ?? undefined,
      category: m.category ?? undefined,
      description: m.description ?? undefined,
      location: [m.location.lat, m.location.lng] as [number, number],
      payload: JSON.stringify(m),
    });
  }
}
