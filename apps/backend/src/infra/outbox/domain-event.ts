import { randomUUID } from 'node:crypto';

export interface Actor {
  type: 'user' | 'ops' | 'system';
  id: string | null;
}

/**
 * Envelope for every domain event (see .claude/skills/santha-architecture/references/events.md).
 * `type` is `<aggregate>.<past_tense_verb>`; payloads are versioned via `v`.
 */
export interface DomainEvent<P = Record<string, unknown>> {
  event_id: string;
  type: string;
  v: number;
  occurred_at: string;
  micro_market_id: string | null;
  actor: Actor;
  aggregate: { type: string; id: string };
  payload: P;
}

export interface NewEvent<P = Record<string, unknown>> {
  type: string;
  v?: number;
  aggregate: { type: string; id: string };
  microMarketId?: string | null;
  actor: Actor;
  payload: P;
}

export function buildEvent<P>(e: NewEvent<P>, now: Date = new Date()): DomainEvent<P> {
  return {
    event_id: randomUUID(),
    type: e.type,
    v: e.v ?? 1,
    occurred_at: now.toISOString(),
    micro_market_id: e.microMarketId ?? null,
    actor: e.actor,
    aggregate: e.aggregate,
    payload: e.payload,
  };
}
