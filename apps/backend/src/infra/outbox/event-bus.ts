import { Injectable } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';
import type { DomainEvent } from './domain-event';

/**
 * Handler for a domain event. Runs inside a transaction together with the dedupe insert into
 * `processed_events`, so DB side-effects happen exactly once per (event, consumer).
 */
export type EventHandler = (event: DomainEvent, tx: Tx) => Promise<void>;

export interface Registration {
  type: string;
  consumer: string;
  handler: EventHandler;
}

/** Modules register their consumers here in `onModuleInit`. `type: '*'` receives every event. */
@Injectable()
export class EventBus {
  private readonly registrations: Registration[] = [];

  on(type: string, consumer: string, handler: EventHandler): void {
    if (this.registrations.some((r) => r.type === type && r.consumer === consumer))
      throw new Error(`Duplicate handler ${consumer} for ${type}`);
    this.registrations.push({ type, consumer, handler });
  }

  handlersFor(type: string): Registration[] {
    return this.registrations.filter((r) => r.type === type || r.type === '*');
  }
}
