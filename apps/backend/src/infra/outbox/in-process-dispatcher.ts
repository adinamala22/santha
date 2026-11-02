import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FakeSinks } from '../fake/fake-sinks';
import type { DomainEvent } from './domain-event';
import { EventBus } from './event-bus';

/**
 * Fake mode (DATA_STORE=memory) replacement for outbox relay → BullMQ → EventsWorker: committed
 * events from in-memory stores go straight to the registered handlers, deduped per
 * (event, consumer) like `processed_events`. A failing handler is logged, as a failed job would be.
 */
@Injectable()
export class InProcessEventDispatcher implements OnModuleInit {
  private readonly logger = new Logger('FakeEvents');
  private readonly processed = new Set<string>();

  constructor(
    private readonly bus: EventBus,
    private readonly sinks: FakeSinks,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.DATA_STORE === 'memory') this.sinks.setDispatcher((events) => this.dispatch(events));
  }

  async dispatch(events: DomainEvent[]): Promise<void> {
    for (const event of events)
      for (const reg of this.bus.handlersFor(event.type)) {
        const key = `${event.event_id}:${reg.consumer}`;
        if (this.processed.has(key)) continue;
        this.processed.add(key);
        try {
          await reg.handler(event, null);
        } catch (err) {
          this.processed.delete(key);
          this.logger.warn(`handler ${reg.consumer} failed for ${event.type}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
  }
}
