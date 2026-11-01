import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { buildEvent, DomainEvent, NewEvent } from './domain-event';

/**
 * Append an event to the outbox. MUST be called with the transaction client that performs the
 * state change, so the event exists if and only if the change committed.
 */
export async function appendToOutbox<P>(tx: Tx, input: NewEvent<P>): Promise<DomainEvent<P>> {
  const event = buildEvent(input);
  await tx.outboxEvent.create({
    data: {
      id: event.event_id,
      type: event.type,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      microMarketId: event.micro_market_id,
      payload: event as unknown as Prisma.InputJsonValue,
      occurredAt: new Date(event.occurred_at),
    },
  });
  return event;
}
