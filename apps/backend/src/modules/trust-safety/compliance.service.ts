import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { ObjectStorage } from '../../infra/storage/object-storage';
import { AddressesService } from '../identity-kyc/addresses.service';
import { AuthService } from '../identity-kyc/auth.service';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments-settlement/payments.service';
import { type ConsentRecord, ComplianceRepository, type DataRequestRecord, type GrievanceRecord } from './compliance.repository';
import { screenReview } from './domain/review-screen';
import { IssuesRepository, type RatingRecord } from './issues.repository';

const H = 3_600_000;
/** Consumer Protection (E-Commerce) Rules 2020, r.4(5): acknowledge within 48 h, resolve within one month. */
export const GRIEVANCE_ACK_H = 48;
export const GRIEVANCE_RESOLVE_DAYS = 30;
/** Notice versions in force; bump when the text on /legal changes so people are asked again. */
export const NOTICE_VERSIONS = { terms: 'terms-2026-11', privacy: 'privacy-2026-11', marketing: 'marketing-2026-11', whatsapp_updates: 'whatsapp-2026-11' } as const;
export type ConsentPurpose = keyof typeof NOTICE_VERSIONS;
const OPEN_ORDER = ['AWAITING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY'];

export interface OpsActor {
  userId: string;
  requestId: string | null;
}

/**
 * trust-safety compliance (M8):
 * - grievances to the Grievance Officer with the legal acknowledgement / resolution clocks;
 * - the DPDP consent ledger (append-only; the latest row per purpose is in force);
 * - data-principal requests: access (a JSON export of everything we hold, ready at once), correction
 *   and erasure (ops completes it; refused while an order is open; money records keep only the id);
 * - review moderation: screened comments are published or held, ops decides, stores reply in public.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly repo: ComplianceRepository,
    private readonly ratings: IssuesRepository,
    private readonly auth: AuthService,
    private readonly addresses: AddressesService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly merchants: MerchantsService,
    private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock();
  }

  // ───────────── grievances ─────────────

  async raiseGrievance(userId: string, app: GrievanceRecord['app'], input: { category: string; description: string; orderId?: string | undefined }): Promise<GrievanceRecord> {
    if (input.orderId) {
      const o = await this.orders.get(input.orderId);
      if (!o || (o.userId !== userId && app === 'consumer')) throw new DomainError('NOT_FOUND', 'Order not found');
    }
    const now = this.clock();
    return this.repo.createGrievance({
      id: randomUUID(),
      userId,
      app,
      orderId: input.orderId ?? null,
      category: input.category,
      description: input.description,
      status: 'open',
      ackDueAt: new Date(now.getTime() + GRIEVANCE_ACK_H * H),
      resolveDueAt: new Date(now.getTime() + GRIEVANCE_RESOLVE_DAYS * 24 * H),
    });
  }

  myGrievances(userId: string) {
    return this.repo.grievances({ userId, limit: 50 });
  }

  grievances(statuses?: readonly GrievanceRecord['status'][]) {
    return this.repo.grievances({ statuses, limit: 300 });
  }

  async acknowledge(id: string, actor: OpsActor): Promise<GrievanceRecord> {
    const g = await this.repo.updateGrievance(id, ['open'], { status: 'acknowledged', acknowledgedAt: this.clock(), handledBy: actor.userId });
    if (!g) throw new DomainError('INVALID_STATE', 'Already acknowledged.');
    await this.repo.appendAudit({ entity: 'grievance', entityId: id, action: 'grievance.acknowledged', actorId: actor.userId, requestId: actor.requestId });
    return g;
  }

  async resolveGrievance(id: string, resolution: string, actor: OpsActor): Promise<GrievanceRecord> {
    const g = await this.repo.updateGrievance(id, ['open', 'acknowledged'], { status: 'resolved', resolution, resolvedAt: this.clock(), handledBy: actor.userId });
    if (!g) throw new DomainError('INVALID_STATE', 'Already resolved.');
    if (!g.acknowledgedAt) await this.repo.updateGrievance(id, ['resolved'], { acknowledgedAt: g.resolvedAt });
    await this.repo.appendAudit({ entity: 'grievance', entityId: id, action: 'grievance.resolved', actorId: actor.userId, requestId: actor.requestId, after: { resolution } });
    return (await this.repo.grievance(id))!;
  }

  // ───────────── consents ─────────────

  async consents(userId: string): Promise<Array<{ purpose: ConsentPurpose; granted: boolean; version: string; current: boolean; at: Date | null }>> {
    const ledger = await this.repo.consents(userId);
    return (Object.keys(NOTICE_VERSIONS) as ConsentPurpose[]).map((purpose) => {
      const last = [...ledger].reverse().find((c) => c.purpose === purpose);
      return { purpose, granted: last?.granted ?? false, version: last?.version ?? NOTICE_VERSIONS[purpose], current: last?.version === NOTICE_VERSIONS[purpose], at: last?.createdAt ?? null };
    });
  }

  async setConsent(userId: string, purpose: ConsentPurpose, granted: boolean, source: ConsentRecord['source']): Promise<void> {
    if ((purpose === 'terms' || purpose === 'privacy') && !granted)
      throw new DomainError('VALIDATION_FAILED', 'Terms and the privacy notice are needed to use Santha. To leave, ask for your account to be deleted.', { field: 'purpose' });
    await this.repo.addConsent({ userId, purpose, version: NOTICE_VERSIONS[purpose], granted, source });
  }

  // ───────────── data-principal requests ─────────────

  async request(userId: string, type: DataRequestRecord['type'], details?: string): Promise<DataRequestRecord> {
    if ((await this.repo.dataRequests({ userId, statuses: ['open'], limit: 20 })).some((r) => r.type === type)) throw new DomainError('ALREADY_EXISTS', 'You already have this request open.');
    const r = await this.repo.createDataRequest({ userId, type, details: details ?? null });
    // Access is self-service: the export is ready at once.
    if (type === 'access') return this.completeAccess(r, null);
    return r;
  }

  myRequests(userId: string) {
    return this.repo.dataRequests({ userId, limit: 50 });
  }

  requests(statuses?: readonly DataRequestRecord['status'][]) {
    return this.repo.dataRequests({ statuses, limit: 300 });
  }

  private async completeAccess(r: DataRequestRecord, by: string | null): Promise<DataRequestRecord> {
    const [me, addresses, orders, wallet, consents, grievances, ratings] = await Promise.all([
      this.auth.me(r.userId),
      this.addresses.list(r.userId),
      this.orders.list(r.userId),
      this.payments.wallet(r.userId),
      this.repo.consents(r.userId),
      this.repo.grievances({ userId: r.userId, limit: 1000 }),
      this.ratings.ratings({ limit: 10_000 }).then((x) => x.filter((y) => y.userId === r.userId)),
    ]);
    const data = {
      generatedAt: this.clock().toISOString(),
      account: { id: me.id, phone: me.phone, name: me.name, locale: me.locale, roles: me.roles },
      addresses,
      orders: orders.map((v) => ({ id: v.order.id, code: v.order.code, state: v.order.state, store: v.merchant.name, totalPaise: v.order.totalPaise, placedAt: v.order.placedAt, address: v.order.address })),
      wallet,
      consents,
      grievances,
      ratings,
    };
    const key = `privacy/exports/${r.userId}/${r.id}.json`;
    await this.storage.put(key, Buffer.from(JSON.stringify(data, null, 2)), 'application/json');
    return (await this.repo.updateDataRequest(r.id, { status: 'completed', exportKey: key, completedAt: this.clock(), completedBy: by }))!;
  }

  async exportFile(userId: string, requestId: string): Promise<Buffer> {
    const r = await this.repo.dataRequest(requestId);
    if (!r || r.userId !== userId || !r.exportKey) throw new DomainError('NOT_FOUND', 'Export not found');
    const b = await this.storage.get(r.exportKey);
    if (!b) throw new DomainError('NOT_FOUND', 'Export not found');
    return b;
  }

  /** Ops completes (erasure / correction) or rejects a request; erasure is refused while orders are open. */
  async decide(id: string, decision: 'complete' | 'reject', note: string, actor: OpsActor): Promise<DataRequestRecord> {
    const r = await this.repo.dataRequest(id);
    if (!r) throw new DomainError('NOT_FOUND', 'Request not found');
    if (r.status !== 'open') throw new DomainError('INVALID_STATE', 'This request was already handled.');
    if (decision === 'complete' && r.type === 'erasure') {
      const open = (await this.orders.list(r.userId)).filter((v) => OPEN_ORDER.includes(v.order.state));
      if (open.length) throw new DomainError('INVALID_STATE', 'The customer has an order in progress; erase after it closes.', { openOrders: open.length });
      await this.auth.erase(r.userId);
    }
    const next = (await this.repo.updateDataRequest(id, { status: decision === 'complete' ? 'completed' : 'rejected', note, completedAt: this.clock(), completedBy: actor.userId }))!;
    await this.repo.appendAudit({ entity: 'data_request', entityId: id, action: `data_request.${decision === 'complete' ? 'completed' : 'rejected'}`, actorId: actor.userId, requestId: actor.requestId, after: { type: r.type, note } });
    return next;
  }

  // ───────────── reviews ─────────────

  /** Screens a new review comment: published, or held for a person. */
  screen(comment: string | null | undefined): Pick<RatingRecord, 'status' | 'flagReason'> {
    const s = screenReview(comment);
    return s.flagged ? { status: 'flagged', flagReason: s.reasons.join(',') } : { status: 'visible', flagReason: null };
  }

  reviewsForMerchant(merchantId: string, includeHidden = false) {
    return this.ratings.ratings({ merchantId, statuses: includeHidden ? undefined : ['visible'], limit: 200 });
  }

  flaggedReviews() {
    return this.ratings.ratings({ statuses: ['flagged'], limit: 200 });
  }

  async moderate(orderId: string, decision: 'publish' | 'hide', actor: OpsActor): Promise<RatingRecord> {
    const r = await this.ratings.rating(orderId);
    if (!r) throw new DomainError('NOT_FOUND', 'Review not found');
    const next = (await this.ratings.updateRating(orderId, { status: decision === 'publish' ? 'visible' : 'hidden' }))!;
    await this.repo.appendAudit({ entity: 'review', entityId: orderId, action: `review.${decision === 'publish' ? 'published' : 'hidden'}`, actorId: actor.userId, requestId: actor.requestId, before: { status: r.status, flagReason: r.flagReason } });
    return next;
  }

  async reply(ownerUserId: string, orderId: string, text: string): Promise<RatingRecord> {
    const m = await this.merchants.ownedBy(ownerUserId);
    const r = await this.ratings.rating(orderId);
    if (!r || r.merchantId !== m.id) throw new DomainError('NOT_FOUND', 'Review not found');
    if (screenReview(text).flagged) throw new DomainError('VALIDATION_FAILED', 'Replies cannot include phone numbers, links or abuse.', { field: 'text' });
    return (await this.ratings.updateRating(orderId, { reply: text, replyAt: this.clock() }))!;
  }
}
