/**
 * Settlement, refunds and trust: pure functions (santha-backend "Key algorithms"). Integer paise only;
 * rounding happens once per component, so totals always equal the sum of their lines.
 */

// ───────────── merchant payout ─────────────

export interface PayoutRates {
  /** Commission ladder (fee card): lower when the store delivered itself. */
  commissionSelfPercent: number;
  commissionRiderPercent: number;
  /** GST on Santha's commission invoice (CGST + SGST, intra-state AP). */
  gstOnCommissionPercent: number;
  /** GST TCS collected by the e-commerce operator (CGST Act s.52) on the store's net supplies. */
  tcsPercent: number;
  /** Income-tax TDS (s.194-O) on the gross amount of sales. */
  tdsPercent: number;
}

export const DEFAULT_PAYOUT_RATES: PayoutRates = { commissionSelfPercent: 6, commissionRiderPercent: 9, gstOnCommissionPercent: 18, tcsPercent: 0.5, tdsPercent: 0.1 };

export interface DeliveredOrder {
  orderId: string;
  code: string;
  mode: 'self' | 'rider' | 'tpl';
  /** Item value the customer paid for (GST-inclusive), before refunds. */
  itemsPaise: number;
  /** Item refunds the store is liable for (unavailable lines, merchant-fault issues). */
  merchantRefundsPaise: number;
  packagingPaise: number;
  /** Quoted delivery fee: credited to the store only when it delivered itself. */
  deliveryFeePaise: number;
  selfBonusPaise: number;
  /** Cash the store's own courier collected (COD, self delivery): already with the store. */
  codCollectedByStorePaise: number;
  /** The customer's tip (ADR-032): the store's when its own staff delivered. */
  tipPaise?: number;
}

export interface PayoutLine {
  orderId: string;
  code: string;
  mode: DeliveredOrder['mode'];
  itemsPaise: number;
  packagingPaise: number;
  deliveryCreditPaise: number;
  bonusPaise: number;
  /** Tip passed on when the store delivered itself (ADR-032). */
  tipPaise: number;
  commissionPercent: number;
  commissionPaise: number;
  commissionGstPaise: number;
  tcsPaise: number;
  tdsPaise: number;
  cashWithStorePaise: number;
  netPaise: number;
}

export interface MerchantPayout {
  lines: PayoutLine[];
  /** Disputes accepted, other credits (+) or debits (−) carried into this payout. */
  adjustmentsPaise: number;
  totals: {
    orders: number;
    itemsPaise: number;
    packagingPaise: number;
    deliveryCreditPaise: number;
    bonusPaise: number;
    commissionPaise: number;
    cgstPaise: number;
    sgstPaise: number;
    tcsPaise: number;
    tdsPaise: number;
    cashWithStorePaise: number;
    adjustmentsPaise: number;
    netPaise: number;
  };
}

const pct = (amount: number, percent: number) => Math.round((amount * percent) / 100);

/**
 * Merchant payout = item value (net of store-liable refunds) + packaging + delivery fee (self only)
 * + self-delivery bonus − commission − GST on commission − TCS − TDS − cash the store already holds
 * + adjustments. Commission, TCS and TDS are on the net item value.
 */
export function computeMerchantPayout(orders: readonly DeliveredOrder[], rates: PayoutRates, adjustmentsPaise = 0): MerchantPayout {
  const lines = orders.map((o): PayoutLine => {
    const items = Math.max(0, o.itemsPaise - o.merchantRefundsPaise);
    const self = o.mode === 'self';
    const rate = self ? rates.commissionSelfPercent : rates.commissionRiderPercent;
    const commission = pct(items, rate);
    const gst = pct(commission, rates.gstOnCommissionPercent);
    const tcs = pct(items, rates.tcsPercent);
    const tds = pct(items, rates.tdsPercent);
    const credit = self ? o.deliveryFeePaise : 0;
    const bonus = self ? o.selfBonusPaise : 0;
    const cash = self ? o.codCollectedByStorePaise : 0;
    const tip = self ? (o.tipPaise ?? 0) : 0;
    return {
      orderId: o.orderId,
      code: o.code,
      mode: o.mode,
      itemsPaise: items,
      packagingPaise: o.packagingPaise,
      deliveryCreditPaise: credit,
      bonusPaise: bonus,
      tipPaise: tip,
      commissionPercent: rate,
      commissionPaise: commission,
      commissionGstPaise: gst,
      tcsPaise: tcs,
      tdsPaise: tds,
      cashWithStorePaise: cash,
      netPaise: items + o.packagingPaise + credit + bonus + tip - commission - gst - tcs - tds - cash,
    };
  });
  const sum = (k: keyof PayoutLine) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const gst = sum('commissionGstPaise');
  const cgst = Math.floor(gst / 2);
  return {
    lines,
    adjustmentsPaise,
    totals: {
      orders: lines.length,
      itemsPaise: sum('itemsPaise'),
      packagingPaise: sum('packagingPaise'),
      deliveryCreditPaise: sum('deliveryCreditPaise'),
      bonusPaise: sum('bonusPaise'),
      commissionPaise: sum('commissionPaise'),
      cgstPaise: cgst,
      sgstPaise: gst - cgst,
      tcsPaise: sum('tcsPaise'),
      tdsPaise: sum('tdsPaise'),
      cashWithStorePaise: sum('cashWithStorePaise'),
      adjustmentsPaise,
      netPaise: sum('netPaise') + adjustmentsPaise,
    },
  };
}

// ───────────── rider payout ─────────────

export interface RiderDelivery {
  orderId: string;
  code: string;
  payPaise: number;
  /** COD cash the rider collected and still holds. */
  codCollectedPaise: number;
}

/**
 * Rider payout = delivery pay (tips included) + incentive bonuses − COD cash collected + cash already deposited with
 * Santha + adjustments (may be negative: the rider owes cash). ADR-032 adds incentives and deposits.
 */
export function computeRiderPayout(deliveries: readonly RiderDelivery[], adjustmentsPaise = 0, extra: { incentivesPaise?: number; depositsPaise?: number } = {}) {
  const earned = deliveries.reduce((s, d) => s + d.payPaise, 0);
  const cash = deliveries.reduce((s, d) => s + d.codCollectedPaise, 0);
  const incentives = extra.incentivesPaise ?? 0;
  const deposits = extra.depositsPaise ?? 0;
  return {
    deliveries: deliveries.length,
    earnedPaise: earned,
    incentivesPaise: incentives,
    cashHeldPaise: cash,
    depositsPaise: deposits,
    adjustmentsPaise,
    netPaise: earned + incentives - cash + deposits + adjustmentsPaise,
  };
}

// ───────────── issues & refunds ─────────────

export type IssueType = 'missing_item' | 'wrong_item' | 'damaged' | 'quality' | 'late' | 'not_delivered' | 'return_request';
export type MerchantKind = 'retail' | 'fashion' | 'home_business' | 'home_kitchen';

/** Reporting windows after delivery (PRD): 2 h cooked food, 24 h retail, 48 h fashion (returns with pickup). */
export function issueWindowMin(kind: MerchantKind): number {
  return kind === 'home_kitchen' ? 120 : kind === 'fashion' ? 48 * 60 : 24 * 60;
}

export function withinWindow(kind: MerchantKind, deliveredAt: Date, now: Date): boolean {
  return now.getTime() - deliveredAt.getTime() <= issueWindowMin(kind) * 60_000;
}

export interface RefundRules {
  /** Auto-approve up to this value when the customer is trusted. */
  autoLimitPaise: number;
  /** Below this trust score everything goes to a person. */
  minTrustForAuto: number;
  /** Late by more than this many minutes earns a flat wallet credit. */
  lateAfterMin: number;
  lateCreditPaise: number;
}

export const DEFAULT_REFUND_RULES: RefundRules = { autoLimitPaise: 30_000, minTrustForAuto: 0.6, lateAfterMin: 15, lateCreditPaise: 2_000 };

export interface IssueInput {
  type: IssueType;
  /** Value of the lines the customer picked (item price × qty), already capped at what was paid. */
  claimedPaise: number;
  /** Minutes late against the promise (late issues). */
  lateMin?: number;
  merchantKind: MerchantKind;
}

export type Liability = 'merchant' | 'platform' | 'rider';

export interface RefundDecision {
  mode: 'auto' | 'manual' | 'reject';
  amountPaise: number;
  destination: 'wallet' | 'source';
  liability: Liability;
  reason: string;
}

/**
 * refunds/decide (issue type × value × trust score → auto / manual): small claims from trusted
 * customers for item problems are refunded to the wallet at once (charged to the store); late orders
 * earn a flat platform-funded credit; non-delivery, returns, big claims and low-trust customers go to
 * a person; nothing is ever paid twice or more than was charged.
 */
export function decideRefund(issue: IssueInput, trust: number, remainingPaise: number, rules: RefundRules = DEFAULT_REFUND_RULES): RefundDecision {
  const cap = (n: number) => Math.max(0, Math.min(n, remainingPaise));
  if (remainingPaise <= 0) return { mode: 'reject', amountPaise: 0, destination: 'wallet', liability: 'platform', reason: 'already_refunded' };
  if (issue.type === 'late') {
    if ((issue.lateMin ?? 0) <= rules.lateAfterMin) return { mode: 'reject', amountPaise: 0, destination: 'wallet', liability: 'platform', reason: 'within_promise' };
    return { mode: trust >= rules.minTrustForAuto ? 'auto' : 'manual', amountPaise: cap(rules.lateCreditPaise), destination: 'wallet', liability: 'platform', reason: 'late_credit' };
  }
  if (issue.type === 'not_delivered') return { mode: 'manual', amountPaise: cap(issue.claimedPaise), destination: 'source', liability: 'rider', reason: 'needs_investigation' };
  if (issue.type === 'return_request') return { mode: 'manual', amountPaise: cap(issue.claimedPaise), destination: 'source', liability: 'merchant', reason: 'return_pickup' };
  const amount = cap(issue.claimedPaise);
  if (amount === 0) return { mode: 'reject', amountPaise: 0, destination: 'wallet', liability: 'merchant', reason: 'nothing_to_refund' };
  const auto = trust >= rules.minTrustForAuto && amount <= rules.autoLimitPaise;
  return { mode: auto ? 'auto' : 'manual', amountPaise: amount, destination: 'wallet', liability: 'merchant', reason: auto ? 'auto_small_trusted' : amount > rules.autoLimitPaise ? 'over_auto_limit' : 'low_trust' };
}

// ───────────── trust score ─────────────

export interface TrustHistory {
  /** Delivered orders in the last 90 days. */
  delivered: number;
  /** Refunds approved in the last 30 days (any destination). */
  refundsLast30d: number;
  /** Issues rejected in the last 90 days. */
  rejectedIssues: number;
  /** Issues raised in the last 7 days. */
  issuesLast7d: number;
}

/** 0–1. New customers start at 0.8; long clean history raises it; frequent refunds and rejections lower it. */
export function trustScore(h: TrustHistory): { score: number; flags: string[] } {
  let s = 0.8 + Math.min(0.15, h.delivered * 0.01);
  s -= Math.max(0, h.refundsLast30d - 2) * 0.12;
  s -= h.rejectedIssues * 0.15;
  const flags: string[] = [];
  if (h.issuesLast7d >= 3) {
    flags.push('frequent_issues');
    s -= 0.2;
  }
  if (h.refundsLast30d >= 5) flags.push('refund_heavy');
  return { score: Math.round(Math.max(0, Math.min(1, s)) * 100) / 100, flags };
}

// ───────────── approvals (four-eyes) ─────────────

export interface ApprovalLimits {
  /** Above this, two different people must approve. */
  fourEyesAbovePaise: number;
  /** Most a single ops user may approve (finance and admin have no cap). */
  opsLimitPaise: number;
}

export const DEFAULT_APPROVAL_LIMITS: ApprovalLimits = { fourEyesAbovePaise: 100_000, opsLimitPaise: 200_000 };

export type ApprovalOutcome = { ok: true; complete: boolean } | { ok: false; reason: 'same_approver' | 'over_limit' };

export function approve(amountPaise: number, prior: readonly string[], approver: { userId: string; roles: readonly string[] }, limits: ApprovalLimits = DEFAULT_APPROVAL_LIMITS): ApprovalOutcome {
  if (prior.includes(approver.userId)) return { ok: false, reason: 'same_approver' };
  const uncapped = approver.roles.includes('finance') || approver.roles.includes('admin');
  if (!uncapped && amountPaise > limits.opsLimitPaise) return { ok: false, reason: 'over_limit' };
  const needed = amountPaise > limits.fourEyesAbovePaise ? 2 : 1;
  return { ok: true, complete: prior.length + 1 >= needed };
}

// ───────────── reconciliation ─────────────

export interface CapturedPayment {
  providerPaymentId: string;
  amountPaise: number;
}
export interface ReportRow {
  providerPaymentId: string;
  amountPaise: number;
  feePaise: number;
}
export interface ReconResult {
  matched: number;
  exceptions: Array<{ kind: 'missing_in_report' | 'amount_mismatch' | 'unknown_in_report'; providerPaymentId: string; expectedPaise: number | null; reportedPaise: number | null }>;
}

/** Matches captured payments against the aggregator settlement report, to the paisa. */
export function reconcile(captured: readonly CapturedPayment[], report: readonly ReportRow[]): ReconResult {
  const byId = new Map(report.map((r) => [r.providerPaymentId, r]));
  const seen = new Set<string>();
  const exceptions: ReconResult['exceptions'] = [];
  let matched = 0;
  for (const c of captured) {
    const r = byId.get(c.providerPaymentId);
    seen.add(c.providerPaymentId);
    if (!r) exceptions.push({ kind: 'missing_in_report', providerPaymentId: c.providerPaymentId, expectedPaise: c.amountPaise, reportedPaise: null });
    else if (r.amountPaise !== c.amountPaise) exceptions.push({ kind: 'amount_mismatch', providerPaymentId: c.providerPaymentId, expectedPaise: c.amountPaise, reportedPaise: r.amountPaise });
    else matched++;
  }
  for (const r of report) if (!seen.has(r.providerPaymentId)) exceptions.push({ kind: 'unknown_in_report', providerPaymentId: r.providerPaymentId, expectedPaise: null, reportedPaise: r.amountPaise });
  return { matched, exceptions };
}

// ───────────── periods (IST) ─────────────

const IST_MS = 330 * 60_000;
/** [start, end) of the IST day `date` (YYYY-MM-DD). */
export function istDay(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
/** The IST week (Mon–Sun) that ends before `date`'s Monday: [start, end). */
export function previousIstWeek(date: string): { start: Date; end: Date } {
  const { start } = istDay(date);
  const dow = new Date(start.getTime() + IST_MS).getUTCDay(); // 0 = Sunday
  const monday = new Date(start.getTime() - ((dow + 6) % 7) * 86_400_000);
  return { start: new Date(monday.getTime() - 7 * 86_400_000), end: monday };
}
