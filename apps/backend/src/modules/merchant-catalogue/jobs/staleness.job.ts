import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { Timers } from '../../../infra/timers/timers';
import { CatalogueService } from '../catalogue.service';

export const STALENESS_JOB = 'catalogue.staleness_sweep';

/**
 * Runs the catalogue staleness sweep on a schedule (tech plan 4.3: repeatable job on `timers`,
 * through the shared Timers service so one worker routes every timer). Ops can also trigger it:
 * POST /v1/ops/catalogue/staleness-sweep.
 */
@Injectable()
export class StalenessJob implements OnModuleInit {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly timers: Timers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    this.timers.register(STALENESS_JOB, () => this.catalogue.sweepStaleness());
    await this.timers.repeat(STALENESS_JOB, this.env.STALENESS_SWEEP_MIN * 60_000);
  }
}
