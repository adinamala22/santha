import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ENV } from '../../../config/config.module';
import { type Env, workersEnabled } from '../../../config/env';
import { redisConnectionOptions } from '../../../infra/queues/queues';
import { QueuesService } from '../../../infra/queues/queues.service';
import { OrdersService } from '../orders.service';

export const PAYMENT_EXPIRY_JOB = 'orders.payment_expiry';
const EVERY_MS = 60_000;

/**
 * Every minute, online orders that were not paid within PAYMENT_WINDOW_MIN become PAYMENT_FAILED
 * (and their promo budget is released). BullMQ repeatable job on `timers` with Postgres; an
 * in-process timer in fake mode (where POST /v1/dev/jobs/payment-expiry runs it on demand).
 */
@Injectable()
export class PaymentExpiryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentExpiryJob.name);
  private worker: Worker | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly orders: OrdersService,
    private readonly queues: QueuesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const run = () => this.orders.expireUnpaid().catch((e: Error) => this.logger.warn(e.message));
    if (this.env.DATA_STORE === 'memory') {
      this.timer = setInterval(() => void run(), EVERY_MS);
      this.timer.unref();
      return;
    }
    if (!workersEnabled(this.env)) return;
    await this.queues.get('timers').upsertJobScheduler(PAYMENT_EXPIRY_JOB, { every: EVERY_MS }, { name: PAYMENT_EXPIRY_JOB });
    this.worker = new Worker(
      'timers',
      async (job) => {
        if (job.name === PAYMENT_EXPIRY_JOB) await run();
      },
      { connection: redisConnectionOptions(this.env.REDIS_URL!), concurrency: 1 },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }
}
