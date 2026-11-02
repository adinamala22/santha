import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { appendAudit, type AuditEntry } from '../../../infra/audit/audit';
import type { FakeSinks } from '../../../infra/fake/fake-sinks';
import { PrismaService } from '../../../infra/prisma/prisma.service';

export interface LeadRecord {
  id: string;
  kind: 'store' | 'home_kitchen' | 'rider';
  name: string;
  phone: string;
  area: string | null;
  message: string | null;
  locale: string;
  status: 'new' | 'contacted' | 'converted' | 'dropped';
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Storage port for website leads (M8). */
export abstract class LeadsRepository {
  abstract create(l: Omit<LeadRecord, 'createdAt' | 'updatedAt' | 'status' | 'note'>): Promise<LeadRecord>;
  /** Ops edit; writes the audit row with the change (same transaction in Postgres). */
  abstract update(id: string, patch: Pick<LeadRecord, 'status'> & { note?: string | null }, audit: Omit<AuditEntry, 'entity' | 'entityId' | 'before' | 'after'>): Promise<LeadRecord | null>;
  abstract list(q: { status?: LeadRecord['status']; limit: number }): Promise<LeadRecord[]>;
  /** A lead from the same phone and kind in the last day (dedupe). */
  abstract recent(phone: string, kind: LeadRecord['kind'], since: Date): Promise<LeadRecord | null>;
}

@Injectable()
export class PrismaLeadsRepository extends LeadsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(l: Omit<LeadRecord, 'createdAt' | 'updatedAt' | 'status' | 'note'>) {
    return (await this.prisma.lead.create({ data: l })) as LeadRecord;
  }

  async update(id: string, patch: Pick<LeadRecord, 'status'> & { note?: string | null }, audit: Omit<AuditEntry, 'entity' | 'entityId' | 'before' | 'after'>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.lead.findUnique({ where: { id } });
      if (!before) return null;
      const after = await tx.lead.update({ where: { id }, data: { ...patch, updatedAt: new Date() } });
      await appendAudit(tx, { ...audit, entity: 'lead', entityId: id, before: { status: before.status }, after: { status: after.status, note: after.note } });
      return after as LeadRecord;
    });
  }

  async list(q: { status?: LeadRecord['status']; limit: number }) {
    return (await this.prisma.lead.findMany({ where: q.status ? { status: q.status } : {}, orderBy: { createdAt: 'desc' }, take: q.limit })) as LeadRecord[];
  }

  async recent(phone: string, kind: LeadRecord['kind'], since: Date) {
    return (await this.prisma.lead.findFirst({ where: { phone, kind, createdAt: { gte: since } } })) as LeadRecord | null;
  }
}

export class InMemoryLeadsRepository extends LeadsRepository {
  private readonly rows: LeadRecord[] = [];

  constructor(private readonly sinks?: FakeSinks) {
    super();
  }

  async create(l: Omit<LeadRecord, 'createdAt' | 'updatedAt' | 'status' | 'note'>) {
    const now = new Date();
    const rec: LeadRecord = { ...l, status: 'new', note: null, createdAt: now, updatedAt: now };
    this.rows.push(rec);
    return structuredClone(rec);
  }

  async update(id: string, patch: Pick<LeadRecord, 'status'> & { note?: string | null }, audit: Omit<AuditEntry, 'entity' | 'entityId' | 'before' | 'after'>) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    const before = { status: r.status };
    Object.assign(r, patch, { updatedAt: new Date() });
    this.sinks?.record([{ ...audit, entity: 'lead', entityId: id, before, after: { status: r.status, note: r.note }, id: randomUUID(), createdAt: new Date() }]);
    return structuredClone(r);
  }

  async list(q: { status?: LeadRecord['status']; limit: number }) {
    return structuredClone(this.rows.filter((r) => !q.status || r.status === q.status).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, q.limit));
  }

  async recent(phone: string, kind: LeadRecord['kind'], since: Date) {
    return structuredClone(this.rows.find((r) => r.phone === phone && r.kind === kind && r.createdAt >= since) ?? null);
  }
}
