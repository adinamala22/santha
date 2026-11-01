import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/** Fixed-window counter. Port so auth logic can be tested without Redis. */
export abstract class RateLimiter {
  abstract hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}

/** Same fixed-window semantics as RedisRateLimiter, held in process memory (DATA_STORE=memory). */
export class MemoryRateLimiter extends RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowSec * 1000 };
      this.windows.set(key, w);
    }
    w.count += 1;
    const allowed = w.count <= limit;
    return { allowed, retryAfterSec: allowed ? 0 : Math.max(Math.ceil((w.resetAt - t) / 1000), 1) };
  }
}

@Injectable()
export class RedisRateLimiter extends RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {
    super();
  }

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const k = `rl:${key}`;
    const [[, count], [, ttl]] = (await this.redis
      .multi()
      .incr(k)
      .ttl(k)
      .exec()) as [[null, number], [null, number]];
    if (ttl < 0) await this.redis.expire(k, windowSec);
    const allowed = count <= limit;
    return { allowed, retryAfterSec: allowed ? 0 : Math.max(ttl, 1) };
  }
}
