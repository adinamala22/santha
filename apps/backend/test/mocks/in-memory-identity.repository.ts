import { RateLimiter, RateLimitResult } from '../../src/modules/identity-kyc/rate-limiter';

/** The in-memory repository lives in src so the local fake mode (DATA_STORE=memory) can use it too. */
export { InMemoryIdentityRepository } from '../../src/modules/identity-kyc/in-memory-identity.repository';

/** Counts hits per key; never resets unless `reset()` is called (deterministic for tests). */
export class InMemoryRateLimiter extends RateLimiter {
  counts = new Map<string, number>();

  async hit(key: string, limit: number): Promise<RateLimitResult> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return { allowed: n <= limit, retryAfterSec: n <= limit ? 0 : 3600 };
  }

  reset(): void {
    this.counts.clear();
  }
}
