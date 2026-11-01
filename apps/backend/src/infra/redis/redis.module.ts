import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisCloser implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy(): Promise<void> {
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
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
    },
    RedisCloser,
  ],
  exports: [REDIS],
})
export class RedisModule {}
