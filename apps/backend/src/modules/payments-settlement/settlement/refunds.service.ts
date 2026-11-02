import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../../common/clock';
import { DomainError } from '../../../common/errors/domain-error';
import { OrdersService } from '../../orders/orders.service';
import { PaymentsService } from '../payments.service';
import { approve, DEFAULT_APPROVAL_LIMITS } from './domain/money';
import { MoneyRepository, type RefundRecord } from './money.repository';

export interface OpsActor {
  userId: string;
  roles: readonly string[];
  requestId: string | null;
}

export type RefundListener = (r: RefundRecord) => Promise<void>;

/**
 * Refunds (M7). The rules engine (trust-safety) decides auto vs manual; this service executes:
 * - auto → processed at once;
 * - manual → pending in /admin/refunds; one approval completes it, or two different people above
 *   ₹1,000 (four-eyes); ops may approve up to ₹2,000, finance and admin without a cap.
 * Processing credits the Santha wallet (instant) or refunds the original payment (Razorpay; COD orders
 * fall back to the wallet), then records the refund on the order. Store-liable refunds reduce the
 * store's next payout. Every ops decision is audited.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  private readonly listeners: RefundListener[] = [];

  constructor(
    private readonly repo: MoneyRepository,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** trust-safety follows refund outcomes (issue status) through this hook. */
  onSettled(fn: RefundListener): void {
    this.listeners.push(fn);
  }

  async request(input: {
    orderId: string;
    issueId: string | null;
    amountPaise: number;
    destination: 'wallet' | 'source';
    liability: RefundRecord['liability'];
    reason: string;
    auto: boolean;
  }): Promise<RefundRecord> {
    const order = await this.orders.get(input.orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
    const open = await this.repo.refunds({ orderId: order.id, statuses: ['pending', 'awaiting_second'], limit: 50 });
    const remaining = order.totalPaise - order.refundedPaise - open.reduce((s, r) => s + r.amountPaise, 0);
    if (input.amountPaise <= 0 || input.amountPaise > remaining) throw new DomainError('VALIDATION_FAILED', 'Refund is more than what is left on the order.', { remainingPaise: remaining });
    const r = await this.repo.createRefund({
      id: randomUUID(),
      orderId: order.id,
      issueId: input.issueId,
      userId: order.userId,
      merchantId: order.merchantId,
      microMarketId: order.microMarketId,
      amountPaise: input.amountPaise,
      destination: input.destination,
      liability: input.liability,
      reason: input.reason,
      status: 'pending',
      approvals: [],
      rejectedBy: null,
      rejectNote: null,
      providerRef: null,
      failureReason: null,
    });
    return input.auto ? this.process(r, null) : r;
  }

  async approve(id: string, actor: OpsActor): Promise<RefundRecord> {
    const r = await this.repo.refund(id);
    if (!r) throw new DomainError('NOT_FOUND', 'Refund not found');
    if (r.status !== 'pending' && r.status !== 'awaiting_second') throw new DomainError('INVALID_STATE', 'This refund was already decided.', { status: r.status });
    const prior = r.approvals.map((a) => a.userId);
    const outcome = approve(r.amountPaise, prior, actor, DEFAULT_APPROVAL_LIMITS);
    if (!outcome.ok)
      throw new DomainError(outcome.reason === 'same_approver' ? 'FOUR_EYES_REQUIRED' : 'APPROVAL_LIMIT', outcome.reason === 'same_approver' ? 'A second person must approve this refund.' : 'This refund is above your approval limit.');
    const approvals = [...r.approvals, { userId: actor.userId, at: this.clock().toISOString() }];
    const next = await this.repo.updateRefund(id, [r.status], { approvals, status: outcome.complete ? 'pending' : 'awaiting_second' });
    if (!next) throw new DomainError('INVALID_STATE', 'This refund changed. Refresh and try again.');
    await this.repo.appendAudit({
      entity: 'refund',
      entityId: id,
      action: outcome.complete ? 'refund.approved' : 'refund.first_approval',
      actorId: actor.userId,
      requestId: actor.requestId,
      microMarketId: r.microMarketId,
      before: { status: r.status, approvals: prior.length },
      after: { status: outcome.complete ? 'approved' : 'awaiting_second', approvals: approvals.length, amountPaise: r.amountPaise },
    });
    return outcome.complete ? this.process(next, actor.userId) : next;
  }

  async reject(id: string, actor: OpsActor, note: string): Promise<RefundRecord> {
    const r = await this.repo.updateRefund(id, ['pending', 'awaiting_second'], { status: 'rejected', rejectedBy: actor.userId, rejectNote: note, processedAt: this.clock() });
    if (!r) throw new DomainError('INVALID_STATE', 'This refund was already decided.');
    await this.repo.appendAudit({ entity: 'refund', entityId: id, action: 'refund.rejected', actorId: actor.userId, requestId: actor.requestId, microMarketId: r.microMarketId, after: { note } });
    await this.notify(r);
    return r;
  }

  private async process(r: RefundRecord, actorId: string | null): Promise<RefundRecord> {
    let ref: string | null = null;
    let destination = r.destination;
    if (destination === 'source') {
      const s = await this.payments.refundToSource(r.orderId, r.amountPaise, `rf_${r.id.slice(0, 8)}`);
      if (s.ok) ref = s.ref;
      else if (s.error === 'not_paid_online') destination = 'wallet'; // COD orders: money back as wallet credit
      else {
        const failed = (await this.repo.updateRefund(r.id, ['pending'], { status: 'failed', failureReason: s.error }))!;
        this.logger.warn({ refundId: r.id, err: s.error }, 'refund to source failed');
        await this.notify(failed);
        return failed;
      }
    }
    if (destination === 'wallet') {
      const order = (await this.orders.get(r.orderId))!;
      const e = await this.payments.creditWallet({ userId: r.userId, amountPaise: r.amountPaise, orderId: r.orderId, note: `Refund for order ${order.code}`, microMarketId: r.microMarketId, actorId });
      ref = e.id;
    }
    const done = await this.repo.updateRefund(r.id, ['pending'], { status: 'processed', destination, providerRef: ref, processedAt: this.clock() });
    if (!done) throw new DomainError('INVALID_STATE', 'This refund changed. Refresh and try again.');
    await this.orders.recordRefund(r.orderId, r.amountPaise);
    await this.notify(done);
    return done;
  }

  private async notify(r: RefundRecord) {
    for (const fn of this.listeners) await fn(r).catch((err: Error) => this.logger.warn({ refundId: r.id, err: err.message }, 'refund listener failed'));
  }

  list(q: Parameters<MoneyRepository['refunds']>[0]) {
    return this.repo.refunds(q);
  }

  get(id: string) {
    return this.repo.refund(id);
  }
}
