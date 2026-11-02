import type { ItemDoc, MerchantDoc } from './domain/documents';

export interface ItemSearch {
  q: string;
  microMarketId: string;
  /** Only available items (any size in stock or low). */
  inStockOnly: boolean;
  vegOnly?: boolean | undefined;
  /** Category browse; with an empty `q` every item of the category matches. */
  categorySlug?: string | undefined;
  limit: number;
}

export interface Hit<T> {
  doc: T;
  /** Text relevance normalised to 0..1 within this result set. */
  text: number;
}

/**
 * Search index port (search-discovery owns it). Typesense in Postgres mode, in-memory in fake mode
 * and unit tests. Both answer the same queries; ranking and grouping happen in DiscoveryService so
 * results do not depend on the engine.
 */
export abstract class SearchIndex {
  abstract readonly engine: 'typesense' | 'memory';
  /** Creates collections and synonyms if missing. */
  abstract ensure(): Promise<void>;
  /** Replaces a merchant's document and all its items (missing items are removed). */
  abstract replaceMerchant(merchant: MerchantDoc, items: ItemDoc[]): Promise<void>;
  abstract removeMerchant(merchantId: string): Promise<void>;
  abstract searchItems(s: ItemSearch): Promise<Hit<ItemDoc>[]>;
  abstract searchMerchants(q: string, microMarketId: string, limit: number): Promise<Hit<MerchantDoc>[]>;
  abstract merchantsIn(microMarketId: string): Promise<MerchantDoc[]>;
  abstract counts(): Promise<{ items: number; merchants: number }>;
}
