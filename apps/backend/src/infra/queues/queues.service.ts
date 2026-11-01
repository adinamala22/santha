import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { QUEUES, QueueName, redisConnectionOptions } from './queues';

/** Lazily-created producers for every queue. Workers are created by their owning module. */
@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  get(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: redisConnectionOptions(this.env.REDIS_URL),
        defaultJobOptions: {
          attempts: 8,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 3600, count: 10_000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  names(): readonly QueueName[] {
    return QUEUES;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
