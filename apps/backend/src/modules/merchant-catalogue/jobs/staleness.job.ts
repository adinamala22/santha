import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ENV } from '../../../config/config.module';
import { type Env, workersEnabled } from '../../../config/env';
import { QueuesService } from '../../../infra/queues/queues.service';
import { redisConnectionOptions } from '../../../infra/queues/queues';
import { CatalogueService } from '../catalogue.service';

export const STALENESS_JOB = 'catalogue.staleness_sweep';

/**
 * Runs the catalogue staleness sweep on a schedule (tech plan 4.3: BullMQ repeatable job). With
 * Postgres it is a repeatable job on the `timers` queue, so only one worker runs each tick; in fake
 * mode an in-process timer. Ops can also trigger it: POST /v1/ops/catalogue/staleness-sweep.
 */
@Injectable()
export class StalenessJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StalenessJob.name);
  private worker: Worker | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly catalogue: CatalogueService,
    private readonly queues: QueuesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const everyMs = this.env.STALENESS_SWEEP_MIN * 60_000;
    if (this.env.DATA_STORE === 'memory') {
      this.timer = setInterval(() => void this.catalogue.sweepStaleness().catch((e: Error) => this.logger.warn(e.message)), everyMs);
      this.timer.unref();
      return;
    }
    if (!workersEnabled(this.env)) return;
    await this.queues.get('timers').upsertJobScheduler(STALENESS_JOB, { every: everyMs }, { name: STALENESS_JOB });
    this.worker = new Worker(
      'timers',
      async (job) => {
        if (job.name === STALENESS_JOB) await this.catalogue.sweepStaleness();
      },
      { connection: redisConnectionOptions(this.env.REDIS_URL), concurrency: 1 },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }
}
