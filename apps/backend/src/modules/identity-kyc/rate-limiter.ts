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
