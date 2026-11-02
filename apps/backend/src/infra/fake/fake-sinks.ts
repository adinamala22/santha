import { Injectable, Logger } from '@nestjs/common';
import type { AuditEntry } from '../audit/audit';
import type { DomainEvent } from '../outbox/domain-event';

export interface StoredAudit extends AuditEntry {
  id: string;
  createdAt: Date;
}

/**
 * Fake mode (DATA_STORE=memory) stand-ins for the outbox and the audit table. In-memory
 * repositories push here after their transaction commits. Provided globally in every mode
 * (cheap, unused with Postgres) so in-memory repositories can always inject it.
 */
@Injectable()
export class FakeSinks {
  private readonly logger = new Logger('FakeStore');
  readonly events: DomainEvent[] = [];
  readonly audits: StoredAudit[] = [];
  private dispatcher: ((events: DomainEvent[]) => Promise<void>) | undefined;

  /** Fake mode: the in-process event dispatcher (stands in for outbox relay + BullMQ). */
  setDispatcher(fn: (events: DomainEvent[]) => Promise<void>): void {
    this.dispatcher = fn;
  }

  async deliver(events: DomainEvent[]): Promise<void> {
    if (events.length && this.dispatcher) await this.dispatcher(events);
  }

  publish(events: DomainEvent[]): void {
    for (const e of events) {
      this.events.push(e);
      this.logger.log(`event ${e.type} ${e.aggregate.type}/${e.aggregate.id} ${JSON.stringify(e.payload)}`);
    }
  }

  record(audits: StoredAudit[]): void {
    for (const a of audits) {
      this.audits.push(a);
      this.logger.log(`audit ${a.entity}/${a.entityId} ${a.action} by ${a.actorId ?? 'system'}`);
    }
  }
}
