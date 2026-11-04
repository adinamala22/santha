import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { DispatchService } from '../dispatch-tracking/dispatch.service';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { OrdersService } from '../orders/orders.service';
import { decideRefund, type IssueType, type MerchantKind, trustScore, withinWindow } from '../payments-settlement/settlement/domain/money';
import { RefundsService } from '../payments-settlement/settlement/refunds.service';
import { StoreRatings } from '../search-discovery/store-ratings';
import { screenReview } from './domain/review-screen';
import { type IssueRecord, IssuesRepository, type RatingRecord } from './issues.repository';

const DAY = 86_400_000;

/**
 * Customer recourse (M7): issues on delivered orders within the reporting window (2 h cooked food,
 * 24 h retail, 48 h fashion returns), decided by the refunds rules engine against the customer's trust
 * score; small trusted claims are refunded to the wallet at once, the rest wait for ops. Ratings feed the
 * rider score used by dispatch.
 */
@Injectable()
export class IssuesService implements OnModuleInit {
  constructor(
    private readonly repo: IssuesRepository,
    private readonly orders: OrdersService,
    private readonly merchants: MerchantsService,
    private readonly dispatch: DispatchService,
    private readonly refunds: RefundsService,
    private readonly storeRatings: StoreRatings,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // Store cards, ranking and the "4★ and above" filter read ratings through search-discovery.
    this.storeRatings.use((merchantId) => this.repo.storeSummary(merchantId));
    this.refunds.onSettled(async (r) => {
      if (!r.issueId) return;
      const issue = await this.repo.issue(r.issueId);
      if (!issue || issue.status === 'auto_resolved' || issue.status === 'rejected') return;
      if (r.status === 'processed') await this.repo.updateIssue(issue.id, { status: 'approved', decidedAt: this.clock() });
      if (r.status === 'rejected') await this.repo.updateIssue(issue.id, { status: 'rejected', decidedAt: this.clock() });
    });
  }

  private async ownedDelivered(userId: string, orderId: string) {
    const order = await this.orders.get(orderId);
    if (!order || order.userId !== userId) throw new DomainError('NOT_FOUND', 'Order not found');
    if (order.state !== 'DELIVERED') throw new DomainError('INVALID_STATE', 'You can report a problem or rate once the order is delivered.', { state: order.state });
    const f = await this.dispatch.fulfilmentForOrder(orderId);
    return { order, fulfilment: f, deliveredAt: f?.deliveredAt ?? order.updatedAt };
  }

  /** Customer trust: history over the last 90 / 30 / 7 days. */
  async trust(userId: string): Promise<{ score: number; flags: string[] }> {
    const now = this.clock().getTime();
    const [views, refunds, rejected, recent] = await Promise.all([
      this.orders.list(userId),
      this.refunds.list({ userId, statuses: ['processed'], since: new Date(now - 30 * DAY), limit: 500 }),
      this.repo.issues({ userId, statuses: ['rejected'], since: new Date(now - 90 * DAY), limit: 500 }),
      this.repo.issues({ userId, since: new Date(now - 7 * DAY), limit: 500 }),
    ]);
    return trustScore({
      delivered: views.filter((v) => v.order.state === 'DELIVERED').length,
      // Refunds for the store's own unavailable items (M5) are not the customer's doing.
      refundsLast30d: refunds.filter((r) => r.issueId).length,
      rejectedIssues: rejected.length,
      issuesLast7d: recent.length,
    });
  }

  async report(userId: string, orderId: string, input: { type: IssueType; variantIds?: string[] | undefined; description?: string | undefined; photoMediaIds?: string[] | undefined }): Promise<IssueRecord> {
    const { order, fulfilment, deliveredAt } = await this.ownedDelivered(userId, orderId);
    const merchant = await this.merchants.record(order.merchantId);
    const now = this.clock();
    if (!withinWindow(merchant.type as MerchantKind, deliveredAt, now)) throw new DomainError('ISSUE_WINDOW_CLOSED', 'The window to report a problem with this order has closed.');
    if (input.type === 'return_request' && merchant.type !== 'fashion') throw new DomainError('VALIDATION_FAILED', 'Returns are only for fashion orders.', { field: 'type' });
    const existing = await this.repo.issues({ orderId, limit: 50 });
    if (existing.some((i) => i.type === input.type)) throw new DomainError('ALREADY_EXISTS', 'You already reported this problem for this order.');

    const itemIssue = ['missing_item', 'wrong_item', 'damaged', 'quality', 'return_request'].includes(input.type);
    const variantIds = input.variantIds ?? [];
    if (itemIssue && variantIds.length === 0) throw new DomainError('VALIDATION_FAILED', 'Choose the items with the problem.', { field: 'variantIds' });
    const lines = order.lines.filter((l) => variantIds.includes(l.variantId) && (l.status ?? 'ok') !== 'removed');
    if (itemIssue && lines.length !== variantIds.length) throw new DomainError('VALIDATION_FAILED', 'Those items are not on this order.', { field: 'variantIds' });
    // Earlier issue refunds on the same lines are not claimed twice (remaining caps the total too).
    const claimed = itemIssue ? lines.reduce((s, l) => s + l.linePaise - (l.refundPaise ?? 0), 0) : input.type === 'not_delivered' ? order.totalPaise : 0;
    const lateMin = fulfilment ? Math.round((deliveredAt.getTime() - fulfilment.promisedAt.getTime()) / 60_000) : 0;

    const trust = await this.trust(userId);
    const pending = await this.refunds.list({ orderId, statuses: ['pending', 'awaiting_second'], limit: 50 });
    const remaining = order.totalPaise - order.refundedPaise - pending.reduce((s, r) => s + r.amountPaise, 0);
    const decision = decideRefund({ type: input.type, claimedPaise: claimed, lateMin, merchantKind: merchant.type as MerchantKind }, trust.score, remaining);

    let issue = await this.repo.createIssue({
      id: randomUUID(),
      orderId,
      userId,
      merchantId: order.merchantId,
      type: input.type,
      variantIds,
      description: input.description ?? null,
      photoMediaIds: input.photoMediaIds ?? [],
      claimedPaise: claimed,
      status: decision.mode === 'reject' ? 'rejected' : input.type === 'return_request' ? 'return_pickup' : 'pending_review',
      trustScore: trust.score,
      decision: { ...decision, flags: trust.flags, lateMin },
      refundId: null,
    });
    if (decision.mode === 'reject') return (await this.repo.updateIssue(issue.id, { decidedAt: now }))!;
    const refund = await this.refunds.request({
      orderId,
      issueId: issue.id,
      amountPaise: decision.amountPaise,
      destination: decision.destination,
      liability: decision.liability,
      reason: `${input.type}:${decision.reason}`,
      auto: decision.mode === 'auto',
    });
    issue = (await this.repo.updateIssue(issue.id, {
      refundId: refund.id,
      ...(refund.status === 'processed' ? { status: 'auto_resolved', decidedAt: now } : {}),
    }))!;
    return issue;
  }

  issuesForOrder(userId: string, orderId: string) {
    return this.orders.get(orderId).then((o) => {
      if (!o || o.userId !== userId) throw new DomainError('NOT_FOUND', 'Order not found');
      return this.repo.issues({ orderId, limit: 50 });
    });
  }

  list(q: Parameters<IssuesRepository['issues']>[0]) {
    return this.repo.issues(q);
  }

  async rate(userId: string, orderId: string, input: { storeStars: number; riderStars?: number | undefined; comment?: string | undefined }): Promise<RatingRecord> {
    const { order, fulfilment } = await this.ownedDelivered(userId, orderId);
    const riderUserId = fulfilment?.mode === 'rider' ? fulfilment.riderUserId : null;
    const riderStars = riderUserId ? (input.riderStars ?? null) : null;
    const comment = input.comment?.trim() || null;
    // Comments are screened (M8): contact details, links or abuse wait for a person.
    const screened = screenReview(comment);
    const added = await this.repo.addRating(
      {
        orderId,
        userId,
        merchantId: order.merchantId,
        riderUserId,
        storeStars: input.storeStars,
        riderStars,
        comment,
        ...(screened.flagged ? { status: 'flagged' as const, flagReason: screened.reasons.join(',') } : {}),
      },
      [
        {
          type: 'rating.submitted',
          aggregate: { type: 'order', id: orderId },
          microMarketId: order.microMarketId,
          actor: { type: 'user', id: userId },
          payload: { order_id: orderId, merchant_id: order.merchantId, rider_user_id: riderUserId, store_stars: input.storeStars, rider_stars: riderStars, has_comment: !!comment, flagged: screened.flagged },
        },
      ],
    );
    if (!added) throw new DomainError('ALREADY_EXISTS', 'You already rated this order.');
    if (riderUserId && input.riderStars) {
      const avg = await this.repo.averages({ riderUserId });
      if (avg.avg != null) await this.dispatch.setRiderRating(riderUserId, avg.avg);
    }
    return (await this.repo.rating(orderId))!;
  }

  rating(orderId: string) {
    return this.repo.rating(orderId);
  }

  /** The customer's own rating of their order, or null if not rated yet. */
  async ratingFor(userId: string, orderId: string): Promise<RatingRecord | null> {
    const order = await this.orders.get(orderId);
    if (!order || order.userId !== userId) throw new DomainError('NOT_FOUND', 'Order not found');
    return this.repo.rating(orderId);
  }

  merchantRating(merchantId: string) {
    return this.repo.averages({ merchantId });
  }

  /** Average, count and 1–5 star breakdown (hidden reviews excluded). Feeds the search index and store pages. */
  storeSummary(merchantId: string) {
    return this.repo.storeSummary(merchantId);
  }
}
