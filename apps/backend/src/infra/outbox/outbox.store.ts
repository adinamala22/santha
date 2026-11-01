import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DomainEvent } from './domain-event';

export interface ClaimedEvent {
  id: string;
  event: DomainEvent;
}

export interface PublishResult {
  published: string[];
  failed: Array<{ id: string; error: string }>;
}

/** Storage port for the relay, so the relay loop can be unit-tested without Postgres. */
export abstract class OutboxStore {
  /**
   * Claims up to `limit` unpublished events (row-locked with SKIP LOCKED so several relays can
   * run), passes them to `publish`, and records the outcome — all in one transaction.
   */
  abstract claimAndPublish(
    limit: number,
    publish: (batch: ClaimedEvent[]) => Promise<PublishResult>,
  ): Promise<PublishResult>;
}

@Injectable()
export class PrismaOutboxStore extends OutboxStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async claimAndPublish(
    limit: number,
    publish: (batch: ClaimedEvent[]) => Promise<PublishResult>,
  ): Promise<PublishResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; payload: DomainEvent }>>`
          SELECT id::text AS id, payload FROM outbox
          WHERE published_at IS NULL
          ORDER BY occurred_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return { published: [], failed: [] };

        const result = await publish(rows.map((r) => ({ id: r.id, event: r.payload })));
        if (result.published.length > 0) {
          await tx.outboxEvent.updateMany({
            where: { id: { in: result.published } },
            data: { publishedAt: new Date(), attempts: { increment: 1 } },
          });
        }
        for (const f of result.failed) {
          await tx.outboxEvent.update({
            where: { id: f.id },
            data: { attempts: { increment: 1 }, lastError: f.error.slice(0, 1000) },
          });
        }
        return result;
      },
      { timeout: 15_000 },
    );
  }
}
