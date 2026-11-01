import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnectionOptions } from '../queues/queues';
import type { DomainEvent } from './domain-event';
import { EventBus } from './event-bus';

/** Consumes the `events` queue and fans out to registered handlers with idempotent dedupe. */
@Injectable()
export class EventsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventsWorker.name);
  private worker: Worker | undefined;

  constructor(
    private readonly bus: EventBus,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.RUN_WORKERS) return;
    this.worker = new Worker<DomainEvent>('events', (job) => this.process(job), {
      connection: redisConnectionOptions(this.env.REDIS_URL),
      concurrency: 8,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn({ eventId: job?.id, type: job?.name, err: err.message }, 'Event handler failed'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Pick<Job<DomainEvent>, 'data'>): Promise<void> {
    const event = job.data;
    for (const reg of this.bus.handlersFor(event.type)) {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.processedEvent.createMany({
          data: [{ eventId: event.event_id, consumer: reg.consumer }],
          skipDuplicates: true,
        });
        if (count === 0) return; // already handled by this consumer
        await reg.handler(event, tx);
      });
    }
  }
}
