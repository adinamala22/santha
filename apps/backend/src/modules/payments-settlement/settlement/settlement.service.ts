import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../../common/clock';
import { DomainError } from '../../../common/errors/domain-error';
import { ObjectStorage } from '../../../infra/storage/object-storage';
import { Timers } from '../../../infra/timers/timers';
import { DEFAULT_CONFIG, FeeRulesSchema } from '../../analytics-config/domain/micro-market-config';
import { MicroMarketsService } from '../../analytics-config/micro-markets.service';
import { DispatchService } from '../../dispatch-tracking/dispatch.service';
import { MerchantsService } from '../../merchant-catalogue/merchants.service';
import { OrdersService } from '../../orders/orders.service';
import { PaymentsService } from '../payments.service';
import {
  computeMerchantPayout,
  computeRiderPayout,
  type DeliveredOrder,
  type PayoutRates,
  istDate,
  istDay,
  previousIstWeek,
  reconcile,
  type RiderDelivery,
} from './domain/money';
import { type DisputeRecord, MoneyRepository, type PartyType, type PayoutRecord, type RunRecord } from './money.repository';
import { rs, textPdf } from './pdf';
import type { OpsActor } from './refunds.service';

const DAILY = 'settlement.daily';
const DISPUTE_WINDOW_H = 48;
/** Linked accounts (Razorpay Route) are created at onboarding in production; dev/mock uses a stable fake id. */
const accountFor = (type: PartyType, id: string) => `acc_${type}_${id.slice(0, 8)}`;

type Order = NonNullable<Awaited<ReturnType<OrdersService['get']>>>;

/**
 * Settlement (M7): merchants daily for the previous IST day, riders weekly (Mon–Sun) or daily by choice.
 * A run is unique per kind and period, so re-running is safe. Each payout keeps its per-order lines,
 * GST on commission (CGST + SGST), TCS and TDS, a PDF statement in object storage, and a Razorpay Route
 * transfer (mock in dev). Negative balances (COD cash held) are carried into the next payout.
 * Reconciliation matches captured payments to the aggregator report and queues every difference.
 * Disputes: a store may dispute a refund charged to it within 48 h; accepted ones are credited back.
 */
@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly repo: MoneyRepository,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly dispatch: DispatchService,
    private readonly merchants: MerchantsService,
    private readonly markets: MicroMarketsService,
    private readonly storage: ObjectStorage,
    private readonly timers: Timers,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timers.register(DAILY, () => this.scheduled());
    void this.timers.repeat(DAILY, 60 * 60_000);
  }

  /** Hourly tick: after 02:00 IST, settle yesterday (and last week on Mondays) if not done yet. */
  async scheduled(): Promise<void> {
    const now = this.clock();
    const istHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
    if (istHour < 2) return;
    const yesterday = istDate(new Date(now.getTime() - 86_400_000));
    await this.runMerchants(yesterday, null).catch((err: Error) => this.logger.error({ err: err.message }, 'merchant settlement failed'));
    await this.runRiders('daily', yesterday, null).catch((err: Error) => this.logger.error({ err: err.message }, 'daily rider settlement failed'));
    if (new Date(now.getTime() + 330 * 60_000).getUTCDay() === 1) await this.runRiders('weekly', istDate(now), null).catch((err: Error) => this.logger.error({ err: err.message }, 'weekly rider settlement failed'));
    await this.reconcileDay(yesterday).catch((err: Error) => this.logger.error({ err: err.message }, 'reconciliation failed'));
  }

  private async rates(microMarketId: string | null): Promise<PayoutRates> {
    const v = microMarketId ? await this.markets.effective(microMarketId, this.clock()) : null;
    const f = FeeRulesSchema.parse(v?.fees ?? DEFAULT_CONFIG.fees);
    return { commissionSelfPercent: f.commissionSelfPercent, commissionRiderPercent: f.commissionRiderPercent, gstOnCommissionPercent: f.gstOnCommissionPercent, tcsPercent: f.tcsPercent, tdsPercent: f.tdsPercent };
  }

  // ───────────── merchants ─────────────

  /** Settles every store for an IST day. Returns the existing run when it already ran. */
  async runMerchants(date: string, actor: OpsActor | null): Promise<RunRecord> {
    const { start, end } = istDay(date);
    const run = await this.repo.createRun({ id: randomUUID(), kind: 'merchant', periodStart: start, periodEnd: end, status: 'running', totals: {}, createdBy: actor?.userId ?? null });
    if (!run) return (await this.repo.findRun('merchant', start, end))!;
    let payouts = 0;
    let net = 0;
    let orders = 0;
    try {
      for (const m of await this.merchants.live()) {
        const p = await this.merchantPayout(run, m.id, m.name, m.microMarketId, start, end);
        if (!p) continue;
        payouts++;
        net += p.netPaise;
        orders += (p.totals.orders as number) ?? 0;
      }
      await this.repo.finishRun(run.id, 'completed', { payouts, orders, netPaise: net });
      if (actor) await this.repo.appendAudit({ entity: 'settlement_run', entityId: run.id, action: 'settlement.run', actorId: actor.userId, requestId: actor.requestId, after: { kind: 'merchant', date, payouts, netPaise: net } });
    } catch (err) {
      await this.repo.finishRun(run.id, 'failed', { payouts, orders, netPaise: net });
      throw err;
    }
    return (await this.repo.findRun('merchant', start, end))!;
  }

  private async deliveredOrder(o: Order, f: Awaited<ReturnType<DispatchService['deliveredForMerchant']>>[number]): Promise<DeliveredOrder> {
    const fees = (o.quote as { bill?: { fees?: Array<{ code: string; amountPaise: number }> } } | null)?.bill?.fees ?? [];
    const fee = (code: string) => fees.find((x) => x.code === code)?.amountPaise ?? 0;
    return {
      orderId: o.id,
      code: o.code,
      mode: f.mode,
      itemsPaise: o.itemsPaise,
      // Lines the store could not supply were refunded at packing time (M5): charged to the store.
      merchantRefundsPaise: o.lines.reduce((s, l) => s + (l.refundPaise ?? 0), 0),
      packagingPaise: fee('packaging'),
      deliveryFeePaise: fee('delivery') + fee('beyond_radius'), // both pay for the trip (ADR-022)
      selfBonusPaise: f.selfBonusPaise,
      codCollectedByStorePaise: f.mode === 'self' ? (f.codCollectedPaise ?? 0) : 0,
      tipPaise: o.tipPaise ?? 0,
    };
  }

  private async merchantPayout(run: RunRecord, merchantId: string, name: string, microMarketId: string | null, start: Date, end: Date): Promise<PayoutRecord | null> {
    const delivered = (await this.dispatch.deliveredForMerchant(merchantId, start)).filter((f) => f.deliveredAt! < end);
    const refunds = await this.repo.merchantLiableRefunds(merchantId, start, end);
    const disputes = (await this.repo.disputes({ merchantId, statuses: ['accepted'], limit: 500 })).filter((d) => !d.settledInPayout);
    const carried = await this.carried('merchant', merchantId, start);
    if (!delivered.length && !refunds.length && !disputes.length && !carried) return null;
    const lines: DeliveredOrder[] = [];
    for (const f of delivered) {
      const o = await this.orders.get(f.orderId);
      if (o) lines.push(await this.deliveredOrder(o, f));
    }
    const adjustments = -refunds.reduce((s, r) => s + r.amountPaise, 0) + disputes.reduce((s, d) => s + d.adjustmentPaise, 0) + (carried?.netPaise ?? 0);
    const p = computeMerchantPayout(lines, await this.rates(microMarketId), adjustments);
    const payout = await this.save(run, 'merchant', merchantId, microMarketId, p.totals.itemsPaise + p.totals.packagingPaise + p.totals.deliveryCreditPaise + p.totals.bonusPaise, p.totals.netPaise, p.lines, {
      ...p.totals,
      refundsChargedPaise: refunds.reduce((s, r) => s + r.amountPaise, 0),
      disputeCreditsPaise: disputes.reduce((s, d) => s + d.adjustmentPaise, 0),
      carriedPaise: carried?.netPaise ?? 0,
    }, p.totals.tcsPaise, p.totals.tdsPaise);
    for (const d of disputes) await this.repo.updateDispute(d.id, ['accepted'], { settledInPayout: payout.id });
    if (carried) await this.repo.updatePayout(carried.id, { transferRef: `carried:${payout.id}` });
    await this.statement(payout, name, refunds.map((r) => ({ id: r.id, amountPaise: r.amountPaise, orderId: r.orderId })));
    return this.transfer(payout);
  }

  /** A previous payout that ended negative and was not yet carried forward. */
  private async carried(type: PartyType, partyId: string, start: Date) {
    const last = await this.repo.lastPayout(type, partyId, start);
    return last && last.status === 'on_hold' && last.netPaise < 0 && !last.transferRef ? last : null;
  }

  private save(run: RunRecord, type: PartyType, partyId: string, microMarketId: string | null, gross: number, net: number, lines: unknown[], totals: Record<string, number>, tcs: number, tds: number) {
    return this.repo.createPayout({
      id: randomUUID(),
      runId: run.id,
      partyType: type,
      partyId,
      microMarketId,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      grossPaise: gross,
      netPaise: net,
      lines,
      totals,
      tcsPaise: tcs,
      tdsPaise: tds,
      status: 'pending',
      transferRef: null,
      failureReason: null,
      statementKey: null,
    });
  }

  private async transfer(p: PayoutRecord): Promise<PayoutRecord> {
    if (p.netPaise <= 0) return (await this.repo.updatePayout(p.id, { status: 'on_hold' }))!;
    const t = await this.payments.transfer(accountFor(p.partyType, p.partyId), p.netPaise, `payout_${p.id.slice(0, 8)}`);
    return (await this.repo.updatePayout(p.id, t.ok ? { status: 'transferred', transferRef: t.ref, transferredAt: this.clock(), failureReason: null } : { status: 'failed', failureReason: t.error }))!;
  }

  /** Ops: try a failed transfer again. */
  async retry(payoutId: string, actor: OpsActor): Promise<PayoutRecord> {
    const p = await this.repo.payout(payoutId);
    if (!p) throw new DomainError('NOT_FOUND', 'Payout not found');
    if (p.status !== 'failed') throw new DomainError('INVALID_STATE', 'Only failed transfers can be retried.', { status: p.status });
    const next = await this.transfer(p);
    await this.repo.appendAudit({ entity: 'payout', entityId: p.id, action: 'payout.retried', actorId: actor.userId, requestId: actor.requestId, after: { status: next.status } });
    return next;
  }

  // ───────────── riders ─────────────

  /** Daily riders for an IST day, or weekly riders for the Mon–Sun week before `date`. */
  async runRiders(cadence: 'daily' | 'weekly', date: string, actor: OpsActor | null): Promise<RunRecord> {
    const { start, end } = cadence === 'daily' ? istDay(date) : previousIstWeek(date);
    const run = await this.repo.createRun({ id: randomUUID(), kind: 'rider', periodStart: start, periodEnd: end, status: 'running', totals: {}, createdBy: actor?.userId ?? null });
    if (!run) return (await this.repo.findRun('rider', start, end))!;
    let payouts = 0;
    let net = 0;
    for (const r of await this.dispatch.ridersAll()) {
      if ((r.payoutCadence ?? 'weekly') !== cadence) continue;
      const delivered = (await this.dispatch.deliveredForRider(r.userId, start)).filter((f) => f.deliveredAt! < end && f.mode === 'rider');
      const carried = await this.carried('rider', r.userId, start);
      const deposits = await this.dispatch.depositsFor(r.userId, start, end);
      if (!delivered.length && !carried && !deposits.length) continue;
      const lines: RiderDelivery[] = [];
      for (const f of delivered) lines.push({ orderId: f.orderId, code: (await this.orders.get(f.orderId))?.code ?? '', payPaise: f.riderPayPaise, codCollectedPaise: f.codCollectedPaise ?? 0 });
      const incentives = await this.dispatch.incentivesEarned(r, start, end);
      const p = computeRiderPayout(lines, carried?.netPaise ?? 0, {
        incentivesPaise: incentives.reduce((s, i) => s + i.bonusPaise, 0),
        depositsPaise: deposits.reduce((s, d) => s + d.amountPaise, 0),
      });
      const payout = await this.save(run, 'rider', r.userId, null, p.earnedPaise, p.netPaise, lines, { ...p }, 0, 0);
      if (carried) await this.repo.updatePayout(carried.id, { transferRef: `carried:${payout.id}` });
      await this.statement(payout, r.name, []);
      const done = await this.transfer(payout);
      payouts++;
      net += done.netPaise;
    }
    await this.repo.finishRun(run.id, 'completed', { payouts, netPaise: net });
    if (actor) await this.repo.appendAudit({ entity: 'settlement_run', entityId: run.id, action: 'settlement.run', actorId: actor.userId, requestId: actor.requestId, after: { kind: `rider_${cadence}`, date, payouts, netPaise: net } });
    return (await this.repo.findRun('rider', start, end))!;
  }

  // ───────────── statements ─────────────

  /** Statement lines as CSV rows (also the source of the PDF). */
  csv(p: PayoutRecord): string {
    const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    if (p.partyType === 'rider') {
      const rows = p.lines as RiderDelivery[];
      return [['order', 'pay_paise', 'cod_collected_paise'].join(','), ...rows.map((r) => [r.code, r.payPaise, r.codCollectedPaise].map(esc).join(','))].join('\n') + '\n';
    }
    const cols = ['code', 'mode', 'itemsPaise', 'packagingPaise', 'deliveryCreditPaise', 'bonusPaise', 'tipPaise', 'commissionPercent', 'commissionPaise', 'commissionGstPaise', 'tcsPaise', 'tdsPaise', 'cashWithStorePaise', 'netPaise'] as const;
    const rows = p.lines as Array<Record<(typeof cols)[number], unknown>>;
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  }

  private async statement(p: PayoutRecord, name: string, refunds: Array<{ id: string; amountPaise: number; orderId: string }>): Promise<void> {
    const t = p.totals;
    const period = `${istDate(p.periodStart)} to ${istDate(new Date(p.periodEnd.getTime() - 1))}`;
    const out: string[] = [`${name}`, `Period: ${period} (IST)    Payout: ${p.id}`, ''];
    if (p.partyType === 'merchant') {
      out.push('Order        Mode   Items        Pack     Delivery  Bonus    Tip      Commission      GST     TCS     TDS    Cash held     Net');
      for (const l of p.lines as Array<Record<string, number | string>>)
        out.push(
          [String(l.code).padEnd(12), String(l.mode).padEnd(6), rs(l.itemsPaise as number).padStart(11), rs(l.packagingPaise as number).padStart(9), rs(l.deliveryCreditPaise as number).padStart(10), rs(l.bonusPaise as number).padStart(8), rs((l.tipPaise as number) ?? 0).padStart(8), `${rs(l.commissionPaise as number)} (${l.commissionPercent}%)`.padStart(16), rs(l.commissionGstPaise as number).padStart(8), rs(l.tcsPaise as number).padStart(8), rs(l.tdsPaise as number).padStart(7), rs(l.cashWithStorePaise as number).padStart(11), rs(l.netPaise as number).padStart(11)].join(' '),
        );
      out.push('', 'Tax invoice for Santha commission (supply of services, SAC 998599):');
      out.push(`  Commission ${rs(t.commissionPaise ?? 0)}   CGST 9% ${rs(t.cgstPaise ?? 0)}   SGST 9% ${rs(t.sgstPaise ?? 0)}   Total ${rs((t.commissionPaise ?? 0) + (t.cgstPaise ?? 0) + (t.sgstPaise ?? 0))}`);
      out.push(`Tax collected: GST TCS (s.52) ${rs(t.tcsPaise ?? 0)}   Income-tax TDS (s.194-O) ${rs(t.tdsPaise ?? 0)}`);
      if (refunds.length) {
        out.push('', 'Credit notes (refunds charged to the store):');
        for (const r of refunds) out.push(`  Refund ${r.id.slice(0, 8)} on order ${r.orderId.slice(0, 8)}   -${rs(r.amountPaise)}`);
      }
      out.push('', `Disputes credited ${rs(t.disputeCreditsPaise ?? 0)}   Carried from earlier ${rs(t.carriedPaise ?? 0)}`);
    } else {
      out.push('Order          Pay        COD cash held');
      for (const l of p.lines as RiderDelivery[]) out.push(`${l.code.padEnd(14)} ${rs(l.payPaise).padStart(10)} ${rs(l.codCollectedPaise).padStart(14)}`);
      out.push('', `Earned ${rs(t.earnedPaise ?? 0)}   Incentives ${rs(t.incentivesPaise ?? 0)}   Cash held ${rs(t.cashHeldPaise ?? 0)}   Deposited ${rs(t.depositsPaise ?? 0)}   Carried ${rs(t.adjustmentsPaise ?? 0)}`);
    }
    out.push('', `NET PAYABLE ${rs(p.netPaise)}${p.netPaise <= 0 ? '  (nothing to transfer; a negative balance is carried to the next payout)' : ''}`);
    const key = `statements/${p.partyType}/${p.partyId}/${istDate(p.periodStart)}-${p.id.slice(0, 8)}.pdf`;
    await this.storage.put(key, textPdf(`Santha settlement statement`, out), 'application/pdf');
    await this.repo.updatePayout(p.id, { statementKey: key });
  }

  async statementPdf(p: PayoutRecord): Promise<Buffer> {
    const b = p.statementKey ? await this.storage.get(p.statementKey) : null;
    if (!b) throw new DomainError('NOT_FOUND', 'Statement not found');
    return b;
  }

  // ───────────── reconciliation ─────────────

  async reconcileDay(date: string, actor?: OpsActor): Promise<{ matched: number; exceptions: number }> {
    const { start, end } = istDay(date);
    const captured = await this.payments.capturedBetween(start, end);
    const report = await this.payments.settlementReport(date, captured);
    const r = reconcile(
      captured.map((c) => ({ providerPaymentId: c.providerPaymentId!, amountPaise: c.amountPaise })),
      report,
    );
    let added = 0;
    for (const e of r.exceptions) if (await this.repo.addReconException({ reportDate: date, ...e })) added++;
    if (actor) await this.repo.appendAudit({ entity: 'reconciliation', entityId: date, action: 'recon.run', actorId: actor.userId, requestId: actor.requestId, after: { matched: r.matched, exceptions: r.exceptions.length } });
    return { matched: r.matched, exceptions: added };
  }

  reconExceptions(status?: 'open' | 'resolved') {
    return this.repo.reconExceptions(status);
  }

  async resolveRecon(id: string, actor: OpsActor, note: string) {
    const r = await this.repo.resolveRecon(id, actor.userId, note);
    if (!r) throw new DomainError('INVALID_STATE', 'Already resolved.');
    await this.repo.appendAudit({ entity: 'reconciliation', entityId: id, action: 'recon.resolved', actorId: actor.userId, requestId: actor.requestId, after: { note } });
    return r;
  }

  // ───────────── disputes ─────────────

  async openDispute(merchantId: string, input: { refundId: string; reason: string; evidenceMediaIds: string[] }): Promise<DisputeRecord> {
    const refund = await this.repo.refund(input.refundId);
    if (!refund || refund.merchantId !== merchantId || refund.liability !== 'merchant' || refund.status !== 'processed') throw new DomainError('NOT_FOUND', 'Refund not found');
    const deadline = new Date(refund.processedAt!.getTime() + DISPUTE_WINDOW_H * 3_600_000);
    if (this.clock() > deadline) throw new DomainError('DISPUTE_WINDOW_CLOSED', 'Disputes must be raised within 48 hours.');
    if ((await this.repo.disputes({ merchantId, limit: 1000 })).some((d) => d.refundId === refund.id)) throw new DomainError('ALREADY_EXISTS', 'This refund is already disputed.');
    return this.repo.createDispute({ id: randomUUID(), merchantId, orderId: refund.orderId, refundId: refund.id, payoutId: null, reason: input.reason, evidenceMediaIds: input.evidenceMediaIds, deadlineAt: deadline });
  }

  async resolveDispute(id: string, decision: 'accept' | 'reject', note: string, actor: OpsActor): Promise<DisputeRecord> {
    const d = await this.repo.dispute(id);
    if (!d) throw new DomainError('NOT_FOUND', 'Dispute not found');
    const refund = d.refundId ? await this.repo.refund(d.refundId) : null;
    const next = await this.repo.updateDispute(id, ['open'], {
      status: decision === 'accept' ? 'accepted' : 'rejected',
      resolutionNote: note,
      adjustmentPaise: decision === 'accept' ? (refund?.amountPaise ?? 0) : 0,
      resolvedAt: this.clock(),
      resolvedBy: actor.userId,
    });
    if (!next) throw new DomainError('INVALID_STATE', 'This dispute was already resolved.');
    await this.repo.appendAudit({ entity: 'dispute', entityId: id, action: `dispute.${decision}ed`, actorId: actor.userId, requestId: actor.requestId, after: { note, adjustmentPaise: next.adjustmentPaise } });
    return next;
  }

  disputes(q: Parameters<MoneyRepository['disputes']>[0]) {
    return this.repo.disputes(q);
  }

  // ───────────── reads ─────────────

  runs(limit = 50) {
    return this.repo.runs(limit);
  }
  payoutsForRun(runId: string) {
    return this.repo.payoutsForRun(runId);
  }
  payoutsForParty(type: PartyType, partyId: string, limit = 60) {
    return this.repo.payoutsForParty(type, partyId, limit);
  }
  payout(id: string) {
    return this.repo.payout(id);
  }
  merchantRefunds(merchantId: string, since: Date) {
    return this.repo.merchantLiableRefunds(merchantId, since, new Date(8.64e15));
  }
  now() {
    return this.clock();
  }
}
