import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { DisputeRecord, PayoutRecord, ReconRecord, RefundRecord, RunRecord } from '../money.repository';

const int = z.number().int();
const iso = z.string().describe('ISO-8601 timestamp');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('IST date YYYY-MM-DD');

// ───────────── inputs ─────────────

export class RunSettlementDto extends createZodDto(z.object({ kind: z.enum(['merchant', 'rider_daily', 'rider_weekly']), date })) {}
export class RejectRefundDto extends createZodDto(z.object({ note: z.string().trim().min(3).max(300) })) {}
export class OpenDisputeDto extends createZodDto(
  z.object({ refundId: z.uuid(), reason: z.string().trim().min(10).max(1000), evidenceMediaIds: z.array(z.uuid()).max(5).default([]) }),
) {}
export class ResolveDisputeDto extends createZodDto(z.object({ decision: z.enum(['accept', 'reject']), note: z.string().trim().min(3).max(500) })) {}
export class ReconRunDto extends createZodDto(z.object({ date })) {}
export class ResolveReconDto extends createZodDto(z.object({ note: z.string().trim().min(3).max(500) })) {}
export class RefundQueryDto extends createZodDto(z.object({ status: z.enum(['open', 'processed', 'rejected', 'failed', 'all']).default('open') })) {}
export class DisputeQueryDto extends createZodDto(z.object({ status: z.enum(['open', 'accepted', 'rejected', 'all']).default('open') })) {}

// ───────────── views ─────────────

const RunSchema = z.object({ id: z.uuid(), kind: z.enum(['merchant', 'rider']), periodStart: iso, periodEnd: iso, status: z.string(), totals: z.record(z.string(), z.number()), createdAt: iso, completedAt: iso.nullable() });
export class RunListDto extends createZodDto(z.object({ items: z.array(RunSchema) })) {}
export class RunDto extends createZodDto(RunSchema) {}

const PayoutSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  partyType: z.enum(['merchant', 'rider']),
  partyId: z.uuid(),
  partyName: z.string(),
  periodStart: iso,
  periodEnd: iso,
  grossPaise: int,
  netPaise: int,
  tcsPaise: int,
  tdsPaise: int,
  status: z.enum(['pending', 'transferred', 'failed', 'on_hold']),
  transferRef: z.string().nullable(),
  failureReason: z.string().nullable(),
  hasStatement: z.boolean(),
  totals: z.record(z.string(), z.number()),
  lines: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  createdAt: iso,
  transferredAt: iso.nullable(),
});
export class PayoutDto extends createZodDto(PayoutSchema) {}
export class PayoutListDto extends createZodDto(z.object({ items: z.array(PayoutSchema) })) {}

const RefundSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderCode: z.string(),
  issueId: z.uuid().nullable(),
  userId: z.uuid(),
  merchantId: z.uuid(),
  merchantName: z.string(),
  amountPaise: int,
  destination: z.enum(['wallet', 'source']),
  liability: z.enum(['merchant', 'platform', 'rider']),
  reason: z.string(),
  status: z.enum(['pending', 'awaiting_second', 'processed', 'rejected', 'failed']),
  approvals: z.array(z.object({ userId: z.uuid(), at: iso })),
  needsSecondApproval: z.boolean(),
  rejectNote: z.string().nullable(),
  failureReason: z.string().nullable(),
  trustScore: z.number().nullable(),
  createdAt: iso,
  processedAt: iso.nullable(),
  /** Merchant view: may still be disputed (48 h). */
  disputable: z.boolean(),
});
export class RefundDto extends createZodDto(RefundSchema) {}
export class RefundListDto extends createZodDto(z.object({ items: z.array(RefundSchema) })) {}

const ReconSchema = z.object({
  id: z.uuid(),
  reportDate: z.string(),
  kind: z.enum(['missing_in_report', 'amount_mismatch', 'unknown_in_report']),
  providerPaymentId: z.string(),
  expectedPaise: int.nullable(),
  reportedPaise: int.nullable(),
  status: z.enum(['open', 'resolved']),
  note: z.string().nullable(),
  createdAt: iso,
});
export class ReconListDto extends createZodDto(z.object({ items: z.array(ReconSchema) })) {}
export class ReconDto extends createZodDto(ReconSchema) {}
export class ReconRunResultDto extends createZodDto(z.object({ matched: int, exceptions: int })) {}

const DisputeSchema = z.object({
  id: z.uuid(),
  merchantId: z.uuid(),
  merchantName: z.string(),
  orderId: z.uuid().nullable(),
  refundId: z.uuid().nullable(),
  reason: z.string(),
  evidenceMediaIds: z.array(z.uuid()),
  status: z.enum(['open', 'accepted', 'rejected']),
  resolutionNote: z.string().nullable(),
  adjustmentPaise: int,
  deadlineAt: iso,
  createdAt: iso,
  resolvedAt: iso.nullable(),
  settledInPayout: z.uuid().nullable(),
});
export class DisputeDto extends createZodDto(DisputeSchema) {}
export class DisputeListDto extends createZodDto(z.object({ items: z.array(DisputeSchema) })) {}

// ───────────── mappers ─────────────

const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;

export const toRunDto = (r: RunRecord) => ({ ...r, periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString(), createdAt: r.createdAt.toISOString(), completedAt: isoOrNull(r.completedAt) });

export const toPayoutDto = (p: PayoutRecord, partyName: string) => ({
  id: p.id,
  runId: p.runId,
  partyType: p.partyType,
  partyId: p.partyId,
  partyName,
  periodStart: p.periodStart.toISOString(),
  periodEnd: p.periodEnd.toISOString(),
  grossPaise: p.grossPaise,
  netPaise: p.netPaise,
  tcsPaise: p.tcsPaise,
  tdsPaise: p.tdsPaise,
  status: p.status,
  transferRef: p.transferRef,
  failureReason: p.failureReason,
  hasStatement: !!p.statementKey,
  totals: p.totals,
  lines: p.lines as Array<Record<string, string | number | null>>,
  createdAt: p.createdAt.toISOString(),
  transferredAt: isoOrNull(p.transferredAt),
});

export const toRefundDto = (r: RefundRecord, extra: { orderCode: string; merchantName: string; trustScore: number | null; disputable: boolean }) => ({
  ...r,
  ...extra,
  needsSecondApproval: r.status === 'awaiting_second',
  createdAt: r.createdAt.toISOString(),
  processedAt: isoOrNull(r.processedAt),
});

export const toReconDto = (r: ReconRecord) => ({ ...r, createdAt: r.createdAt.toISOString() });

export const toDisputeDto = (d: DisputeRecord, merchantName: string) => ({
  ...d,
  merchantName,
  deadlineAt: d.deadlineAt.toISOString(),
  createdAt: d.createdAt.toISOString(),
  resolvedAt: isoOrNull(d.resolvedAt),
});
