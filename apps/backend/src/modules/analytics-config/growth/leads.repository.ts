import { Injectable } from '@nestjs/common';
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
  abstract update(id: string, patch: Pick<LeadRecord, 'status'> & { note?: string | null }): Promise<LeadRecord | null>;
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

  async update(id: string, patch: Pick<LeadRecord, 'status'> & { note?: string | null }) {
    const n = await this.prisma.lead.updateMany({ where: { id }, data: { ...patch, updatedAt: new Date() } });
    return n.count ? ((await this.prisma.lead.findUnique({ where: { id } })) as LeadRecord) : null;
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

  async create(l: Omit<LeadRecord, 'createdAt' | 'updatedAt' | 'status' | 'note'>) {
    const now = new Date();
    const rec: LeadRecord = { ...l, status: 'new', note: null, createdAt: now, updatedAt: now };
    this.rows.push(rec);
    return structuredClone(rec);
  }

  async update(id: string, patch: Pick<LeadRecord, 'status'> & { note?: string | null }) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: new Date() });
    return structuredClone(r);
  }

  async list(q: { status?: LeadRecord['status']; limit: number }) {
    return structuredClone(this.rows.filter((r) => !q.status || r.status === q.status).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, q.limit));
  }

  async recent(phone: string, kind: LeadRecord['kind'], since: Date) {
    return structuredClone(this.rows.find((r) => r.phone === phone && r.kind === kind && r.createdAt >= since) ?? null);
  }
}
