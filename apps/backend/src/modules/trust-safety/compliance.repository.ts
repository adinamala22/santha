import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface GrievanceRecord {
  id: string;
  userId: string;
  app: 'consumer' | 'merchant' | 'rider';
  orderId: string | null;
  category: string;
  description: string;
  status: 'open' | 'acknowledged' | 'resolved';
  resolution: string | null;
  ackDueAt: Date;
  resolveDueAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  handledBy: string | null;
  createdAt: Date;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  purpose: string;
  version: string;
  granted: boolean;
  source: 'app' | 'web' | 'ops';
  createdAt: Date;
}

export interface DataRequestRecord {
  id: string;
  userId: string;
  type: 'access' | 'correction' | 'erasure';
  details: string | null;
  status: 'open' | 'completed' | 'rejected';
  note: string | null;
  exportKey: string | null;
  createdAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
}

/** Storage port for trust-safety compliance (M8): grievances, the consent ledger, data-principal requests. */
export abstract class ComplianceRepository {
  abstract createGrievance(g: Omit<GrievanceRecord, 'acknowledgedAt' | 'resolvedAt' | 'handledBy' | 'resolution'>): Promise<GrievanceRecord>;
  abstract grievance(id: string): Promise<GrievanceRecord | null>;
  abstract updateGrievance(id: string, expected: readonly GrievanceRecord['status'][], patch: Partial<Pick<GrievanceRecord, 'status' | 'resolution' | 'acknowledgedAt' | 'resolvedAt' | 'handledBy'>>): Promise<GrievanceRecord | null>;
  abstract grievances(q: { userId?: string; statuses?: readonly GrievanceRecord['status'][]; limit: number }): Promise<GrievanceRecord[]>;

  abstract addConsent(c: Omit<ConsentRecord, 'id' | 'createdAt'>): Promise<ConsentRecord>;
  /** Every consent row of a user, oldest first (the ledger). */
  abstract consents(userId: string): Promise<ConsentRecord[]>;

  abstract createDataRequest(r: Omit<DataRequestRecord, 'id' | 'createdAt' | 'completedAt' | 'completedBy' | 'note' | 'exportKey' | 'status'>): Promise<DataRequestRecord>;
  abstract dataRequest(id: string): Promise<DataRequestRecord | null>;
  abstract updateDataRequest(id: string, patch: Partial<Pick<DataRequestRecord, 'status' | 'note' | 'exportKey' | 'completedAt' | 'completedBy'>>): Promise<DataRequestRecord | null>;
  abstract dataRequests(q: { userId?: string; statuses?: readonly DataRequestRecord['status'][]; limit: number }): Promise<DataRequestRecord[]>;

  abstract appendAudit(a: AuditEntry): Promise<void>;
}

@Injectable()
export class PrismaComplianceRepository extends ComplianceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createGrievance(g: Omit<GrievanceRecord, 'acknowledgedAt' | 'resolvedAt' | 'handledBy' | 'resolution'>) {
    return (await this.prisma.grievance.create({ data: g })) as GrievanceRecord;
  }

  async grievance(id: string) {
    return (await this.prisma.grievance.findUnique({ where: { id } })) as GrievanceRecord | null;
  }

  async updateGrievance(id: string, expected: readonly GrievanceRecord['status'][], patch: Partial<Pick<GrievanceRecord, 'status' | 'resolution' | 'acknowledgedAt' | 'resolvedAt' | 'handledBy'>>) {
    const n = await this.prisma.grievance.updateMany({ where: { id, status: { in: [...expected] } }, data: patch });
    return n.count ? this.grievance(id) : null;
  }

  async grievances(q: { userId?: string; statuses?: readonly GrievanceRecord['status'][]; limit: number }) {
    return (await this.prisma.grievance.findMany({
      where: { ...(q.userId ? { userId: q.userId } : {}), ...(q.statuses ? { status: { in: [...q.statuses] } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    })) as GrievanceRecord[];
  }

  async addConsent(c: Omit<ConsentRecord, 'id' | 'createdAt'>) {
    return (await this.prisma.consent.create({ data: { ...c, id: randomUUID() } })) as ConsentRecord;
  }

  async consents(userId: string) {
    return (await this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })) as ConsentRecord[];
  }

  async createDataRequest(r: Omit<DataRequestRecord, 'id' | 'createdAt' | 'completedAt' | 'completedBy' | 'note' | 'exportKey' | 'status'>) {
    return (await this.prisma.dataRequest.create({ data: { ...r, id: randomUUID(), status: 'open' } })) as DataRequestRecord;
  }

  async dataRequest(id: string) {
    return (await this.prisma.dataRequest.findUnique({ where: { id } })) as DataRequestRecord | null;
  }

  async updateDataRequest(id: string, patch: Partial<Pick<DataRequestRecord, 'status' | 'note' | 'exportKey' | 'completedAt' | 'completedBy'>>) {
    const n = await this.prisma.dataRequest.updateMany({ where: { id }, data: patch });
    return n.count ? this.dataRequest(id) : null;
  }

  async dataRequests(q: { userId?: string; statuses?: readonly DataRequestRecord['status'][]; limit: number }) {
    return (await this.prisma.dataRequest.findMany({
      where: { ...(q.userId ? { userId: q.userId } : {}), ...(q.statuses ? { status: { in: [...q.statuses] } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    })) as DataRequestRecord[];
  }

  async appendAudit(a: AuditEntry) {
    await appendAudit(this.prisma, a);
  }
}

/** Fake mode + tests. */
export class InMemoryComplianceRepository extends ComplianceRepository {
  private readonly g: GrievanceRecord[] = [];
  private readonly c: ConsentRecord[] = [];
  private readonly r: DataRequestRecord[] = [];

  constructor(private readonly sinks?: FakeSinks) {
    super();
  }

  private clone<T>(v: T): T {
    return structuredClone(v);
  }

  async createGrievance(x: Omit<GrievanceRecord, 'acknowledgedAt' | 'resolvedAt' | 'handledBy' | 'resolution'>) {
    const rec: GrievanceRecord = { ...this.clone(x), resolution: null, acknowledgedAt: null, resolvedAt: null, handledBy: null };
    this.g.push(rec);
    return this.clone(rec);
  }

  async grievance(id: string) {
    return this.clone(this.g.find((x) => x.id === id) ?? null);
  }

  async updateGrievance(id: string, expected: readonly GrievanceRecord['status'][], patch: Partial<Pick<GrievanceRecord, 'status' | 'resolution' | 'acknowledgedAt' | 'resolvedAt' | 'handledBy'>>) {
    const x = this.g.find((y) => y.id === id);
    if (!x || !expected.includes(x.status)) return null;
    Object.assign(x, this.clone(patch));
    return this.clone(x);
  }

  async grievances(q: { userId?: string; statuses?: readonly GrievanceRecord['status'][]; limit: number }) {
    return this.clone(
      this.g
        .filter((x) => (!q.userId || x.userId === q.userId) && (!q.statuses || q.statuses.includes(x.status)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  async addConsent(x: Omit<ConsentRecord, 'id' | 'createdAt'>) {
    const last = this.c.at(-1)?.createdAt.getTime() ?? 0;
    const rec: ConsentRecord = { ...x, id: randomUUID(), createdAt: new Date(Math.max(Date.now(), last + 1)) };
    this.c.push(rec);
    return this.clone(rec);
  }

  async consents(userId: string) {
    return this.clone(this.c.filter((x) => x.userId === userId));
  }

  async createDataRequest(x: Omit<DataRequestRecord, 'id' | 'createdAt' | 'completedAt' | 'completedBy' | 'note' | 'exportKey' | 'status'>) {
    const rec: DataRequestRecord = { ...x, id: randomUUID(), status: 'open', note: null, exportKey: null, createdAt: new Date(), completedAt: null, completedBy: null };
    this.r.push(rec);
    return this.clone(rec);
  }

  async dataRequest(id: string) {
    return this.clone(this.r.find((x) => x.id === id) ?? null);
  }

  async updateDataRequest(id: string, patch: Partial<Pick<DataRequestRecord, 'status' | 'note' | 'exportKey' | 'completedAt' | 'completedBy'>>) {
    const x = this.r.find((y) => y.id === id);
    if (!x) return null;
    Object.assign(x, this.clone(patch));
    return this.clone(x);
  }

  async dataRequests(q: { userId?: string; statuses?: readonly DataRequestRecord['status'][]; limit: number }) {
    return this.clone(
      this.r
        .filter((x) => (!q.userId || x.userId === q.userId) && (!q.statuses || q.statuses.includes(x.status)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  async appendAudit(a: AuditEntry) {
    this.sinks?.record([{ ...a, id: randomUUID(), createdAt: new Date() }]);
  }
}
