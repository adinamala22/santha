import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../audit/audit';
import { buildEvent, type DomainEvent, type NewEvent } from '../outbox/domain-event';
import type { FakeSinks, StoredAudit } from './fake-sinks';

/** What an in-memory transaction can emit; flushed to FakeSinks only if the transaction commits. */
export interface MemoryTxEffects {
  event<P>(e: NewEvent<P>): void;
  audit(a: AuditEntry): void;
}

/**
 * Base for in-memory repositories (fake mode + unit tests). Holds all state in one
 * structured-cloneable object so a transaction can snapshot it and restore on throw, matching
 * Postgres rollback. Transactions run one at a time. Reads return clones so callers can never
 * mutate stored state by accident.
 */
export abstract class MemoryStore<S extends object> {
  protected state: S;
  private lock: Promise<unknown> = Promise.resolve();

  protected constructor(
    initial: S,
    protected readonly sinks?: FakeSinks,
  ) {
    this.state = initial;
  }

  protected async runTx<T>(fn: (fx: MemoryTxEffects) => Promise<T>): Promise<T> {
    const run = this.lock.then(async () => {
      const snapshot = structuredClone(this.state);
      const events: DomainEvent[] = [];
      const audits: StoredAudit[] = [];
      const fx: MemoryTxEffects = {
        event: (e) => events.push(buildEvent(e as NewEvent) as DomainEvent),
        audit: (a) => audits.push({ ...a, id: randomUUID(), createdAt: new Date() }),
      };
      try {
        const result = await fn(fx);
        this.sinks?.publish(events);
        this.sinks?.record(audits);
        return { result, events };
      } catch (err) {
        this.state = snapshot;
        throw err;
      }
    });
    this.lock = run.catch(() => undefined);
    const { result, events } = await run;
    // Like the outbox relay: consumers run after commit and outside the store lock, so a handler
    // may start its own transaction. Awaited so fake-mode tests see consumers' effects at once.
    await this.sinks?.deliver(events);
    return result;
  }

  protected clone<T>(v: T): T {
    return structuredClone(v);
  }
}
