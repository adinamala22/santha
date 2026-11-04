import { Injectable, Logger } from '@nestjs/common';

export interface StoreRating {
  avg: number | null;
  count: number;
}

const NONE: StoreRating = { avg: null, count: 0 };

/**
 * Where store cards get their rating. Ratings belong to trust-safety, which imports this module, so
 * trust-safety registers its source here at start-up (search-discovery never imports trust-safety:
 * the module graph stays acyclic). Without a source, or if it fails, stores show as unrated: search
 * must keep working when ratings cannot be read.
 */
@Injectable()
export class StoreRatings {
  private readonly logger = new Logger(StoreRatings.name);
  private source: ((merchantId: string) => Promise<StoreRating>) | undefined;

  use(source: (merchantId: string) => Promise<StoreRating>): void {
    this.source = source;
  }

  async get(merchantId: string): Promise<StoreRating> {
    if (!this.source) return NONE;
    try {
      const r = await this.source(merchantId);
      return { avg: r.avg == null ? null : Math.round(r.avg * 10) / 10, count: r.count };
    } catch (err) {
      this.logger.warn(`store rating unavailable for ${merchantId}: ${err instanceof Error ? err.message : String(err)}`);
      return NONE;
    }
  }
}
