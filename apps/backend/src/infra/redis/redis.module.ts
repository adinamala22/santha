import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisCloser implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy(): Promise<void> {
    // Never connected (lazyConnect, or DATA_STORE=memory): disconnect without dialling Redis first.
    if (this.redis.status === 'wait') return this.redis.disconnect();
    await this.redis.quit().catch(() => undefined);
  }
}

/** Shared ioredis connection for app use (rate limits, caches, idempotency). BullMQ uses its own. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      // In memory mode REDIS_URL is empty; the client is created but never connects.
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL || 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 2 }),
    },
    RedisCloser,
  ],
  exports: [REDIS],
})
export class RedisModule {}
