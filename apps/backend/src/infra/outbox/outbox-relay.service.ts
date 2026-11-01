import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import { type Env, workersEnabled } from '../../config/env';
import { QueuesService } from '../queues/queues.service';
import { ClaimedEvent, OutboxStore, PublishResult } from './outbox.store';

export const RELAY_BATCH_SIZE = 100;

/**
 * Polls the outbox and publishes events to the BullMQ `events` queue. jobId = event_id, so a
 * crash between publish and commit cannot create a duplicate job; consumers dedupe anyway.
 * Runs only when RUN_WORKERS=true and DATA_STORE=postgres.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly store: OutboxStore,
    private readonly queues: QueuesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (!workersEnabled(this.env)) return;
    this.logger.log(`Outbox relay started (poll ${this.env.OUTBOX_POLL_MS} ms)`);
    this.schedule(0);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    let delay = this.env.OUTBOX_POLL_MS;
    try {
      const n = await this.relayOnce();
      if (n === RELAY_BATCH_SIZE) delay = 0; // backlog: keep draining
    } catch (err) {
      this.logger.warn({ err }, 'Outbox relay tick failed');
      delay = Math.min(this.env.OUTBOX_POLL_MS * 10, 10_000);
    }
    this.schedule(delay);
  }

  /** Relays one batch; returns how many events were claimed. */
  async relayOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const result = await this.store.claimAndPublish(RELAY_BATCH_SIZE, (batch) => this.publish(batch));
      if (result.failed.length > 0)
        this.logger.warn({ failed: result.failed.length }, 'Some outbox events failed to publish');
      return result.published.length + result.failed.length;
    } finally {
      this.running = false;
    }
  }

  private async publish(batch: ClaimedEvent[]): Promise<PublishResult> {
    const queue = this.queues.get('events');
    const out: PublishResult = { published: [], failed: [] };
    for (const { id, event } of batch) {
      try {
        await queue.add(event.type, event, { jobId: id });
        out.published.push(id);
      } catch (err) {
        out.failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }
}
