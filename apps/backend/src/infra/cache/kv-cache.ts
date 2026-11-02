import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { REDIS } from '../redis/redis.module';

/** Small JSON key-value cache with TTL: Redis with Postgres, in-process in fake mode. */
export abstract class KvCache {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSec: number): Promise<void>;
}

export class RedisKvCache extends KvCache {
  constructor(private readonly redis: Redis) {
    super();
  }

  async get<T>(key: string): Promise<T | null> {
    const v = await this.redis.get(key);
    return v == null ? null : (JSON.parse(v) as T);
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
  }
}

/** Bounded in-process cache (insertion-order eviction). */
export class MemoryKvCache extends KvCache {
  private readonly map = new Map<string, { v: string; exp: number }>();

  constructor(private readonly maxEntries = 50_000) {
    super();
  }

  async get<T>(key: string): Promise<T | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return JSON.parse(e.v) as T;
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { v: JSON.stringify(value), exp: Date.now() + ttlSec * 1000 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: KvCache,
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) => (env.DATA_STORE === 'memory' ? new MemoryKvCache() : new RedisKvCache(redis)),
    },
  ],
  exports: [KvCache],
})
export class CacheModule {}
