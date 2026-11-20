import { Injectable, Logger } from '@nestjs/common';

export interface ItemRating {
  avg: number;
  count: number;
}

/**
 * Where store pages get the star rating of each item (ADR-045). Same route as StoreRatings: ratings belong to
 * trust-safety, which imports this module, so trust-safety registers its source at start-up and search-discovery never
 * imports it. Without a source, or if it fails, items show as unrated: the store page must keep loading.
 */
@Injectable()
export class ItemRatings {
  private readonly logger = new Logger(ItemRatings.name);
  private source: ((merchantId: string) => Promise<Map<string, ItemRating>>) | undefined;

  use(source: (merchantId: string) => Promise<Map<string, ItemRating>>): void {
    this.source = source;
  }

  /** Rated items of one store, by item id. */
  async forStore(merchantId: string): Promise<Map<string, ItemRating>> {
    if (!this.source) return new Map();
    try {
      return await this.source(merchantId);
    } catch (err) {
      this.logger.warn(`item ratings unavailable for ${merchantId}: ${err instanceof Error ? err.message : String(err)}`);
      return new Map();
    }
  }
}
