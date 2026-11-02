import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { appendAudit, type AuditEntry } from '../../../infra/audit/audit';
import type { FakeSinks } from '../../../infra/fake/fake-sinks';
import { PrismaService } from '../../../infra/prisma/prisma.service';

export type PartyType = 'merchant' | 'rider';
export type RefundStatus = 'pending' | 'awaiting_second' | 'processed' | 'rejected' | 'failed';
export type DisputeStatus = 'open' | 'accepted' | 'rejected';

export interface RunRecord {
  id: string;
  kind: PartyType;
  periodStart: Date;
  periodEnd: Date;
  status: 'running' | 'completed' | 'failed';
  totals: Record<string, number>;
  createdBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface PayoutRecord {
  id: string;
  runId: string;
  partyType: PartyType;
  partyId: string;
  microMarketId: string | null;
  periodStart: Date;
  periodEnd: Date;
  grossPaise: number;
  netPaise: number;
  lines: unknown[];
  totals: Record<string, number>;
  tcsPaise: number;
  tdsPaise: number;
  status: 'pending' | 'transferred' | 'failed' | 'on_hold';
  transferRef: string | null;
  failureReason: string | null;
  statementKey: string | null;
  createdAt: Date;
  transferredAt: Date | null;
}

export interface RefundRecord {
  id: string;
  orderId: string;
  issueId: string | null;
  userId: string;
  merchantId: string;
  microMarketId: string;
  amountPaise: number;
  destination: 'wallet' | 'source';
  liability: 'merchant' | 'platform' | 'rider';
  reason: string;
  status: RefundStatus;
  approvals: Array<{ userId: string; at: string }>;
  rejectedBy: string | null;
  rejectNote: string | null;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface ReconRecord {
  id: string;
  reportDate: string;
  kind: 'missing_in_report' | 'amount_mismatch' | 'unknown_in_report';
  providerPaymentId: string;
  expectedPaise: number | null;
  reportedPaise: number | null;
  status: 'open' | 'resolved';
  note: string | null;
  resolvedBy: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface DisputeRecord {
  id: string;
  merchantId: string;
  orderId: string | null;
  refundId: string | null;
  payoutId: string | null;
  reason: string;
  evidenceMediaIds: string[];
  status: DisputeStatus;
  resolutionNote: string | null;
  adjustmentPaise: number;
  deadlineAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  settledInPayout: string | null;
}

type NewRun = Omit<RunRecord, 'createdAt' | 'completedAt'>;
type NewPayout = Omit<PayoutRecord, 'createdAt' | 'transferredAt'>;
type NewRefund = Omit<RefundRecord, 'createdAt' | 'processedAt'>;
type NewRecon = Omit<ReconRecord, 'id' | 'createdAt' | 'resolvedAt' | 'resolvedBy' | 'note' | 'status'>;
type NewDispute = Omit<DisputeRecord, 'createdAt' | 'resolvedAt' | 'resolvedBy' | 'settledInPayout' | 'resolutionNote' | 'adjustmentPaise' | 'status'>;

/** Storage port for settlement: runs, payouts, refunds, reconciliation exceptions, disputes. */
export abstract class MoneyRepository {
  abstract findRun(kind: PartyType, start: Date, end: Date): Promise<RunRecord | null>;
  /** Null when a run for the same kind and period exists (one run per period). */
  abstract createRun(r: NewRun): Promise<RunRecord | null>;
  abstract finishRun(id: string, status: RunRecord['status'], totals: Record<string, number>): Promise<void>;
  abstract runs(limit: number): Promise<RunRecord[]>;

  abstract createPayout(p: NewPayout): Promise<PayoutRecord>;
  abstract updatePayout(id: string, patch: Partial<Pick<PayoutRecord, 'status' | 'transferRef' | 'failureReason' | 'statementKey' | 'transferredAt'>>): Promise<PayoutRecord | null>;
  abstract payout(id: string): Promise<PayoutRecord | null>;
  abstract payoutsForRun(runId: string): Promise<PayoutRecord[]>;
  abstract payoutsForParty(type: PartyType, partyId: string, limit: number): Promise<PayoutRecord[]>;
  /** Latest payout of a party before `before` (for negative balances carried forward). */
  abstract lastPayout(type: PartyType, partyId: string, before: Date): Promise<PayoutRecord | null>;

  abstract createRefund(r: NewRefund): Promise<RefundRecord>;
  abstract refund(id: string): Promise<RefundRecord | null>;
  /** Compare-and-swap on status. */
  abstract updateRefund(id: string, expected: readonly RefundStatus[], patch: Partial<Omit<RefundRecord, 'id' | 'orderId' | 'createdAt'>>): Promise<RefundRecord | null>;
  abstract refunds(q: { statuses?: readonly RefundStatus[]; orderId?: string; userId?: string; since?: Date; limit: number }): Promise<RefundRecord[]>;
  /** Processed refunds charged to a store within [from, to). */
  abstract merchantLiableRefunds(merchantId: string, from: Date, to: Date): Promise<RefundRecord[]>;

  abstract addReconException(e: NewRecon): Promise<boolean>;
  abstract reconExceptions(status?: ReconRecord['status']): Promise<ReconRecord[]>;
  abstract resolveRecon(id: string, by: string, note: string): Promise<ReconRecord | null>;

  abstract createDispute(d: NewDispute): Promise<DisputeRecord>;
  abstract dispute(id: string): Promise<DisputeRecord | null>;
  abstract updateDispute(id: string, expected: readonly DisputeStatus[] | null, patch: Partial<Omit<DisputeRecord, 'id' | 'merchantId' | 'createdAt'>>): Promise<DisputeRecord | null>;
  abstract disputes(q: { merchantId?: string; statuses?: readonly DisputeStatus[]; limit: number }): Promise<DisputeRecord[]>;

  abstract appendAudit(a: AuditEntry): Promise<void>;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const asRun = (r: Prisma.SettlementRunGetPayload<object>) => r as unknown as RunRecord;
const asPayout = (r: Prisma.PayoutGetPayload<object>) => r as unknown as PayoutRecord;
const asRefund = (r: Prisma.RefundRequestGetPayload<object>) => r as unknown as RefundRecord;

@Injectable()
export class PrismaMoneyRepository extends MoneyRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findRun(kind: PartyType, start: Date, end: Date) {
    const r = await this.prisma.settlementRun.findUnique({ where: { kind_periodStart_periodEnd: { kind, periodStart: start, periodEnd: end } } });
    return r && asRun(r);
  }

  async createRun(r: NewRun) {
    try {
      return asRun(await this.prisma.settlementRun.create({ data: { ...r, totals: json(r.totals) } }));
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return null;
      throw e;
    }
  }

  async finishRun(id: string, status: RunRecord['status'], totals: Record<string, number>) {
    await this.prisma.settlementRun.update({ where: { id }, data: { status, totals: json(totals), completedAt: new Date() } });
  }

  async runs(limit: number) {
    return (await this.prisma.settlementRun.findMany({ orderBy: { createdAt: 'desc' }, take: limit })).map(asRun);
  }

  async createPayout(p: NewPayout) {
    return asPayout(await this.prisma.payout.create({ data: { ...p, lines: json(p.lines), totals: json(p.totals) } }));
  }

  async updatePayout(id: string, patch: Partial<Pick<PayoutRecord, 'status' | 'transferRef' | 'failureReason' | 'statementKey' | 'transferredAt'>>) {
    const n = await this.prisma.payout.updateMany({ where: { id }, data: patch });
    return n.count ? this.payout(id) : null;
  }

  async payout(id: string) {
    const r = await this.prisma.payout.findUnique({ where: { id } });
    return r && asPayout(r);
  }

  async payoutsForRun(runId: string) {
    return (await this.prisma.payout.findMany({ where: { runId }, orderBy: { netPaise: 'desc' } })).map(asPayout);
  }

  async payoutsForParty(type: PartyType, partyId: string, limit: number) {
    return (await this.prisma.payout.findMany({ where: { partyType: type, partyId }, orderBy: { periodStart: 'desc' }, take: limit })).map(asPayout);
  }

  async lastPayout(type: PartyType, partyId: string, before: Date) {
    const r = await this.prisma.payout.findFirst({ where: { partyType: type, partyId, periodStart: { lt: before } }, orderBy: { periodStart: 'desc' } });
    return r && asPayout(r);
  }

  async createRefund(r: NewRefund) {
    return asRefund(await this.prisma.refundRequest.create({ data: { ...r, approvals: json(r.approvals) } }));
  }

  async refund(id: string) {
    const r = await this.prisma.refundRequest.findUnique({ where: { id } });
    return r && asRefund(r);
  }

  async updateRefund(id: string, expected: readonly RefundStatus[], patch: Partial<Omit<RefundRecord, 'id' | 'orderId' | 'createdAt'>>) {
    const { approvals, ...rest } = patch;
    const n = await this.prisma.refundRequest.updateMany({ where: { id, status: { in: [...expected] } }, data: { ...rest, ...(approvals ? { approvals: json(approvals) } : {}) } });
    return n.count ? this.refund(id) : null;
  }

  async refunds(q: { statuses?: readonly RefundStatus[]; orderId?: string; userId?: string; since?: Date; limit: number }) {
    const rows = await this.prisma.refundRequest.findMany({
      where: {
        ...(q.statuses ? { status: { in: [...q.statuses] } } : {}),
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.since ? { createdAt: { gte: q.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.map(asRefund);
  }

  async merchantLiableRefunds(merchantId: string, from: Date, to: Date) {
    return (await this.prisma.refundRequest.findMany({ where: { merchantId, liability: 'merchant', status: 'processed', processedAt: { gte: from, lt: to } } })).map(asRefund);
  }

  async addReconException(e: NewRecon) {
    try {
      await this.prisma.reconException.create({ data: { ...e, id: randomUUID(), status: 'open' } });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return false;
      throw err;
    }
  }

  async reconExceptions(status?: ReconRecord['status']) {
    return (await this.prisma.reconException.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 500 })) as ReconRecord[];
  }

  async resolveRecon(id: string, by: string, note: string) {
    const n = await this.prisma.reconException.updateMany({ where: { id, status: 'open' }, data: { status: 'resolved', resolvedBy: by, note, resolvedAt: new Date() } });
    return n.count ? ((await this.prisma.reconException.findUnique({ where: { id } })) as ReconRecord) : null;
  }

  async createDispute(d: NewDispute) {
    return (await this.prisma.dispute.create({ data: { ...d, status: 'open' } })) as DisputeRecord;
  }

  async dispute(id: string) {
    return (await this.prisma.dispute.findUnique({ where: { id } })) as DisputeRecord | null;
  }

  async updateDispute(id: string, expected: readonly DisputeStatus[] | null, patch: Partial<Omit<DisputeRecord, 'id' | 'merchantId' | 'createdAt'>>) {
    const n = await this.prisma.dispute.updateMany({ where: { id, ...(expected ? { status: { in: [...expected] } } : {}) }, data: patch });
    return n.count ? this.dispute(id) : null;
  }

  async disputes(q: { merchantId?: string; statuses?: readonly DisputeStatus[]; limit: number }) {
    return (await this.prisma.dispute.findMany({
      where: { ...(q.merchantId ? { merchantId: q.merchantId } : {}), ...(q.statuses ? { status: { in: [...q.statuses] } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    })) as DisputeRecord[];
  }

  async appendAudit(a: AuditEntry) {
    await appendAudit(this.prisma, a);
  }
}

/** Fake mode + tests. */
export class InMemoryMoneyRepository extends MoneyRepository {
  private readonly runRows: RunRecord[] = [];
  private readonly payoutRows: PayoutRecord[] = [];
  private readonly refundRows: RefundRecord[] = [];
  private readonly recon: ReconRecord[] = [];
  private readonly disputeRows: DisputeRecord[] = [];

  constructor(private readonly sinks?: FakeSinks) {
    super();
  }

  private c<T>(v: T): T {
    return structuredClone(v);
  }

  async findRun(kind: PartyType, start: Date, end: Date) {
    return this.c(this.runRows.find((r) => r.kind === kind && r.periodStart.getTime() === start.getTime() && r.periodEnd.getTime() === end.getTime()) ?? null);
  }

  async createRun(r: NewRun) {
    if (this.runRows.some((x) => x.kind === r.kind && x.periodStart.getTime() === r.periodStart.getTime() && x.periodEnd.getTime() === r.periodEnd.getTime())) return null;
    const rec: RunRecord = { ...this.c(r), createdAt: new Date(), completedAt: null };
    this.runRows.push(rec);
    return this.c(rec);
  }

  async finishRun(id: string, status: RunRecord['status'], totals: Record<string, number>) {
    const r = this.runRows.find((x) => x.id === id);
    if (r) Object.assign(r, { status, totals: this.c(totals), completedAt: new Date() });
  }

  async runs(limit: number) {
    return this.c([...this.runRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit));
  }

  async createPayout(p: NewPayout) {
    if (this.payoutRows.some((x) => x.runId === p.runId && x.partyType === p.partyType && x.partyId === p.partyId)) throw new Error('payout exists');
    const rec: PayoutRecord = { ...this.c(p), createdAt: new Date(), transferredAt: null };
    this.payoutRows.push(rec);
    return this.c(rec);
  }

  async updatePayout(id: string, patch: Partial<Pick<PayoutRecord, 'status' | 'transferRef' | 'failureReason' | 'statementKey' | 'transferredAt'>>) {
    const r = this.payoutRows.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, this.c(patch));
    return this.c(r);
  }

  async payout(id: string) {
    return this.c(this.payoutRows.find((x) => x.id === id) ?? null);
  }

  async payoutsForRun(runId: string) {
    return this.c(this.payoutRows.filter((x) => x.runId === runId).sort((a, b) => b.netPaise - a.netPaise));
  }

  async payoutsForParty(type: PartyType, partyId: string, limit: number) {
    return this.c(
      this.payoutRows
        .filter((x) => x.partyType === type && x.partyId === partyId)
        .sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())
        .slice(0, limit),
    );
  }

  async lastPayout(type: PartyType, partyId: string, before: Date) {
    return (await this.payoutsForParty(type, partyId, 1000)).find((p) => p.periodStart < before) ?? null;
  }

  async createRefund(r: NewRefund) {
    const rec: RefundRecord = { ...this.c(r), createdAt: new Date(), processedAt: null };
    this.refundRows.push(rec);
    return this.c(rec);
  }

  async refund(id: string) {
    return this.c(this.refundRows.find((x) => x.id === id) ?? null);
  }

  async updateRefund(id: string, expected: readonly RefundStatus[], patch: Partial<Omit<RefundRecord, 'id' | 'orderId' | 'createdAt'>>) {
    const r = this.refundRows.find((x) => x.id === id);
    if (!r || !expected.includes(r.status)) return null;
    Object.assign(r, this.c(patch));
    return this.c(r);
  }

  async refunds(q: { statuses?: readonly RefundStatus[]; orderId?: string; userId?: string; since?: Date; limit: number }) {
    return this.c(
      this.refundRows
        .filter((r) => (!q.statuses || q.statuses.includes(r.status)) && (!q.orderId || r.orderId === q.orderId) && (!q.userId || r.userId === q.userId) && (!q.since || r.createdAt >= q.since))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  async merchantLiableRefunds(merchantId: string, from: Date, to: Date) {
    return this.c(this.refundRows.filter((r) => r.merchantId === merchantId && r.liability === 'merchant' && r.status === 'processed' && r.processedAt && r.processedAt >= from && r.processedAt < to));
  }

  async addReconException(e: NewRecon) {
    if (this.recon.some((x) => x.reportDate === e.reportDate && x.providerPaymentId === e.providerPaymentId && x.kind === e.kind)) return false;
    this.recon.push({ ...this.c(e), id: randomUUID(), status: 'open', note: null, resolvedBy: null, createdAt: new Date(), resolvedAt: null });
    return true;
  }

  async reconExceptions(status?: ReconRecord['status']) {
    return this.c(this.recon.filter((x) => !status || x.status === status).reverse());
  }

  async resolveRecon(id: string, by: string, note: string) {
    const r = this.recon.find((x) => x.id === id && x.status === 'open');
    if (!r) return null;
    Object.assign(r, { status: 'resolved', resolvedBy: by, note, resolvedAt: new Date() });
    return this.c(r);
  }

  async createDispute(d: NewDispute) {
    const rec: DisputeRecord = { ...this.c(d), status: 'open', resolutionNote: null, adjustmentPaise: 0, createdAt: new Date(), resolvedAt: null, resolvedBy: null, settledInPayout: null };
    this.disputeRows.push(rec);
    return this.c(rec);
  }

  async dispute(id: string) {
    return this.c(this.disputeRows.find((x) => x.id === id) ?? null);
  }

  async updateDispute(id: string, expected: readonly DisputeStatus[] | null, patch: Partial<Omit<DisputeRecord, 'id' | 'merchantId' | 'createdAt'>>) {
    const r = this.disputeRows.find((x) => x.id === id);
    if (!r || (expected && !expected.includes(r.status))) return null;
    Object.assign(r, this.c(patch));
    return this.c(r);
  }

  async disputes(q: { merchantId?: string; statuses?: readonly DisputeStatus[]; limit: number }) {
    return this.c(
      this.disputeRows
        .filter((d) => (!q.merchantId || d.merchantId === q.merchantId) && (!q.statuses || q.statuses.includes(d.status)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  async appendAudit(a: AuditEntry) {
    this.sinks?.record([{ ...a, id: randomUUID(), createdAt: new Date() }]);
  }
}
