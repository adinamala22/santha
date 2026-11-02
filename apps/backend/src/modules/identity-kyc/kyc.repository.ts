import { Injectable } from '@nestjs/common';
import { Prisma, type KycKind, type KycStatus, type KycSubject } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { MemoryStore } from '../../infra/fake/memory-tx';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type { KycKind, KycStatus, KycSubject };

export interface Subject {
  type: KycSubject;
  id: string;
}

export interface KycCheckRecord {
  id: string;
  subjectType: KycSubject;
  subjectId: string;
  kind: KycKind;
  status: KycStatus;
  valueMasked: string | null;
  valuePublic: string | null;
  nameOnRecord: string | null;
  provider: string;
  providerRef: string | null;
  failureReason: string | null;
  details: Record<string, unknown> | null;
  verifiedAt: Date | null;
  updatedAt: Date;
}

export type KycCheckInput = Omit<KycCheckRecord, 'id' | 'subjectType' | 'subjectId' | 'updatedAt'>;

/** Storage port for KYC checks (identity-kyc owns the table; other modules use KycService). */
export abstract class KycRepository {
  abstract list(subject: Subject): Promise<KycCheckRecord[]>;
  abstract get(subject: Subject, kind: KycKind): Promise<KycCheckRecord | null>;
  /** Replace the (subject, kind) check and append its event in one transaction. */
  abstract save(subject: Subject, check: KycCheckInput, event: NewEvent): Promise<KycCheckRecord>;
}

const toRecord = (r: {
  id: string;
  subjectType: KycSubject;
  subjectId: string;
  kind: KycKind;
  status: KycStatus;
  valueMasked: string | null;
  valuePublic: string | null;
  nameOnRecord: string | null;
  provider: string;
  providerRef: string | null;
  failureReason: string | null;
  details: Prisma.JsonValue;
  verifiedAt: Date | null;
  updatedAt: Date;
}): KycCheckRecord => ({ ...r, details: (r.details as Record<string, unknown> | null) ?? null });

@Injectable()
export class PrismaKycRepository extends KycRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(subject: Subject): Promise<KycCheckRecord[]> {
    const rows = await this.prisma.kycCheck.findMany({ where: { subjectType: subject.type, subjectId: subject.id } });
    // Order by kind name (not enum position) so both stores agree.
    return rows.map(toRecord).sort((a, b) => a.kind.localeCompare(b.kind));
  }

  async get(subject: Subject, kind: KycKind): Promise<KycCheckRecord | null> {
    const r = await this.prisma.kycCheck.findUnique({
      where: { subjectType_subjectId_kind: { subjectType: subject.type, subjectId: subject.id, kind } },
    });
    return r ? toRecord(r) : null;
  }

  save(subject: Subject, check: KycCheckInput, event: NewEvent): Promise<KycCheckRecord> {
    const data = { ...check, details: check.details ? (check.details as Prisma.InputJsonValue) : Prisma.JsonNull };
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.kycCheck.upsert({
        where: { subjectType_subjectId_kind: { subjectType: subject.type, subjectId: subject.id, kind: check.kind } },
        create: { ...data, subjectType: subject.type, subjectId: subject.id },
        update: data,
      });
      await appendToOutbox(tx, event);
      return toRecord(r);
    });
  }
}

export class InMemoryKycRepository extends KycRepository {
  private readonly store: KycStore;

  constructor(sinks?: FakeSinks) {
    super();
    this.store = new KycStore(sinks);
  }

  async list(subject: Subject): Promise<KycCheckRecord[]> {
    return this.store.read((rows) =>
      rows.filter((r) => r.subjectType === subject.type && r.subjectId === subject.id).sort((a, b) => a.kind.localeCompare(b.kind)),
    );
  }

  async get(subject: Subject, kind: KycKind): Promise<KycCheckRecord | null> {
    return (await this.list(subject)).find((r) => r.kind === kind) ?? null;
  }

  save(subject: Subject, check: KycCheckInput, event: NewEvent): Promise<KycCheckRecord> {
    return this.store.save(subject, check, event);
  }

  /** Loads demo checks directly (no events) — fake-mode boot only. */
  seed(subject: Subject, check: KycCheckInput): void {
    this.store.load(subject, check);
  }
}

class KycStore extends MemoryStore<{ rows: KycCheckRecord[] }> {
  constructor(sinks?: FakeSinks) {
    super({ rows: [] }, sinks);
  }

  read<T>(fn: (rows: KycCheckRecord[]) => T): T {
    return this.clone(fn(this.state.rows));
  }

  load(subject: Subject, check: KycCheckInput): void {
    this.state.rows.push({ ...this.clone(check), id: randomUUID(), subjectType: subject.type, subjectId: subject.id, updatedAt: new Date() });
  }

  save(subject: Subject, check: KycCheckInput, event: NewEvent): Promise<KycCheckRecord> {
    return this.runTx(async (fx) => {
      const existing = this.state.rows.find(
        (r) => r.subjectType === subject.type && r.subjectId === subject.id && r.kind === check.kind,
      );
      const row: KycCheckRecord = {
        ...this.clone(check),
        id: existing?.id ?? randomUUID(),
        subjectType: subject.type,
        subjectId: subject.id,
        updatedAt: new Date(),
      };
      this.state.rows = [...this.state.rows.filter((r) => r !== existing), row];
      fx.event(event);
      return this.clone(row);
    });
  }
}
