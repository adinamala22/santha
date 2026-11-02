import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';

/**
 * Every mutating ops action writes one audit row in the same transaction as the change
 * (CLAUDE.md). `before`/`after` hold the changed fields only, never secrets or full PII.
 */
export interface AuditEntry {
  entity: string;
  entityId: string;
  action: string;
  actorId: string | null;
  microMarketId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string | null;
}

const json = (v: Record<string, unknown> | null | undefined) =>
  v == null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

export async function appendAudit(tx: Tx, a: AuditEntry): Promise<void> {
  await tx.auditEvent.create({
    data: {
      entity: a.entity,
      entityId: a.entityId,
      action: a.action,
      actorId: a.actorId,
      microMarketId: a.microMarketId ?? null,
      before: json(a.before),
      after: json(a.after),
      requestId: a.requestId ?? null,
    },
  });
}
