import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { DomainEvent } from '../../infra/outbox/domain-event';
import { EventBus } from '../../infra/outbox/event-bus';
import { CallMaskingProvider } from '../../infra/providers/calls/call-masking.provider';
import { ThreePlProvider } from '../../infra/providers/threepl/threepl.provider';
import { Timers } from '../../infra/timers/timers';
import {
  DEFAULT_CONFIG,
  FeeRulesSchema,
  RiderPaySchema,
  SlaSchema,
} from '../analytics-config/domain/micro-market-config';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { AuthService } from '../identity-kyc/auth.service';
import type { MerchantRecord } from '../merchant-catalogue/domain/merchant';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderLifecycleService } from '../orders/lifecycle.service';

import { OrdersService } from '../orders/orders.service';
import {
  DEFAULT_WEIGHTS,
  DELAY_NOTICE_MIN,
  FALLBACK_STEP_MIN,
  type LatLng,
  OFFER_RADIUS_M,
  type PayLine,
  SELF_DELIVERY_BONUS_PAISE,
  STANDBY_RADIUS_M,
  type Candidate,
  batchEligible,
  fourDigits,
  haversineM,
  liveEta,
  nextFallbackStage,
  promisedAt,
  riderPay,
  score,
  travelMin,
} from './domain/dispatch';
import { type RiderSosRecord,
  ACTIVE_STATES,
  DispatchRepository,
  type FulfilmentRecord,
  type OfferRecord,
  type RiderRecord,
} from './dispatch.repository';
import type { FAILED_REASONS } from './dto/dispatch.dto';
import { RiderLocations } from './rider-locations';
import { RiderPhotosService } from './rider-photos.service';

export const OFFER_SEC = 30;
const RETRY_SEC = 30;
const T_OFFER = 'dispatch.offer_expired';
const T_RETRY = 'dispatch.search_retry';
const T_SOS_REPAGE = 'dispatch.sos_repage';
const T_FALLBACK = 'dispatch.fallback';
const key = (fulfilmentId: string, t: 'offer' | 'retry' | 'fallback') => `fulfilment:${fulfilmentId}:${t}`;

type OrderRecord = NonNullable<Awaited<ReturnType<OrdersService['get']>>>;

/** Door-photo proof is allowed for prepaid orders up to ₹2,000 (ADR-030). */
export const PHOTO_PROOF_MAX_PAISE = 200_000;

const IST_MS = 330 * 60_000;
/** Start of the IST day containing `now`. */
const notApproved = (r: RiderRecord | null) =>
  new DomainError(
    'RIDER_NOT_APPROVED',
    r?.status === 'suspended'
      ? 'Your account is paused. Contact Santha support.'
      : 'Finish your sign-up and wait for approval before going online.',
    { status: r?.status ?? 'draft' },
  );

export const istDayStart = (now: Date) =>
  new Date(Math.floor((now.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);
/** Monday 00:00 IST of the week containing `now`. */
export const istWeekStart = (now: Date) => {
  const today = istDayStart(now);
  const dow = new Date(today.getTime() + IST_MS).getUTCDay(); // 0 = Sunday
  return new Date(today.getTime() - ((dow + 6) % 7) * 86_400_000);
};

export interface OpsActor {
  userId: string;
  requestId: string | null;
}
export type Courier = { kind: 'staff' | 'owner' | 'rider' | 'tpl'; name: string };
interface Ctx {
  order: OrderRecord;
  merchant: MerchantRecord;
  store: LatLng;
  drop: LatLng;
}

/**
 * dispatch-tracking (M6): how an accepted order reaches the customer.
 * - self: the store's staff (or the owner) delivers with a tokenised link; lower commission + delivery fee credit.
 * - rider: score online riders near the store, offer to the best one for 30 s, next one on decline/expiry,
 *   batch a second order only when the detour is ≤ 6 min; after `riderFallbackMin` walk the fallback
 *   ladder: 3PL → self-delivery bonus → standby pool → tell the customer (new ETA or cancel with refund).
 * Pickup needs the store's pickup code (riders); delivery needs the customer's OTP or a photo.
 * Live location goes to Redis GEO and to the customer's socket; the ETA is recomputed on each fix and the
 * customer is told once if it slips more than 5 min past the promise.
 * Events in: order.accepted, order.ready, order.cancelled.
 */
@Injectable()
export class DispatchService implements OnModuleInit {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly repo: DispatchRepository,
    private readonly locations: RiderLocations,
    private readonly orders: OrdersService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly merchants: MerchantsService,
    private readonly markets: MicroMarketsService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
    private readonly threePl: ThreePlProvider,
    private readonly calls: CallMaskingProvider,
    private readonly photos: RiderPhotosService,
    private readonly timers: Timers,
    private readonly bus: EventBus,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.bus.on('order.accepted', 'dispatch', (e) => this.onAccepted(e));
    this.bus.on('order.ready', 'dispatch', (e) => this.onReady(e));
    this.bus.on('order.cancelled', 'dispatch', (e) => this.onCancelled(e));
    this.timers.register(T_OFFER, (d) => this.onOfferExpired(d.offerId as string));
    this.timers.register(T_RETRY, (d) => this.search(d.fulfilmentId as string));
    this.timers.register(T_FALLBACK, (d) => this.fallback(d.fulfilmentId as string));
    this.timers.register(T_SOS_REPAGE, (d) => this.pageSos(d.sosId as string, 'again'));
  }

  // ───────────── config & context ─────────────

  private async config(microMarketId: string) {
    const v = await this.markets.effective(microMarketId, this.clock());
    return {
      sla: SlaSchema.parse(v?.sla ?? DEFAULT_CONFIG.sla),
      riderPay: RiderPaySchema.parse(v?.riderPay ?? DEFAULT_CONFIG.riderPay),
      fees: FeeRulesSchema.parse(v?.fees ?? DEFAULT_CONFIG.fees),
    };
  }

  private async ctx(f: Pick<FulfilmentRecord, 'orderId' | 'merchantId'>): Promise<Ctx> {
    const [order, merchant] = await Promise.all([
      this.orders.get(f.orderId),
      this.merchants.record(f.merchantId),
    ]);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
    const drop = order.address.location;
    return { order, merchant, drop, store: merchant.location ?? drop };
  }

  private code = () => fourDigits(() => randomInt(0, 10_000) / 10_000);
  private token = () => randomBytes(18).toString('base64url');
  staffLink = (token: string) => `${this.env.WEB_BASE_URL.replace(/\/$/, '')}/d/${token}`;

  // ───────────── start ─────────────

  private async onAccepted(e: DomainEvent): Promise<void> {
    const p = e.payload as { fulfilment_mode?: 'self' | 'rider'; staff_id?: string | null; pack_by?: string };
    const orderId = e.aggregate.id;
    if (await this.repo.fulfilmentForOrder(orderId)) return; // replayed event
    const order = await this.orders.get(orderId);
    if (!order) return;
    const merchant = await this.merchants.record(order.merchantId);
    const { sla } = await this.config(order.microMarketId);
    const now = this.clock();
    const store = merchant.location ?? order.address.location;
    const storeToDropM = Math.round(haversineM(store, order.address.location));
    const readyBy = order.packBy ?? (p.pack_by ? new Date(p.pack_by) : now);
    const mode = p.fulfilment_mode ?? order.fulfilmentMode ?? 'rider';
    const f = await this.repo.createFulfilment({
      id: randomUUID(),
      orderId,
      merchantId: order.merchantId,
      microMarketId: order.microMarketId,
      mode,
      state: mode === 'self' ? 'assigned' : 'searching',
      staffId: mode === 'self' ? (p.staff_id ?? null) : null,
      staffToken: mode === 'self' ? this.token() : null,
      riderUserId: null,
      tplRef: null,
      pickupCode: this.code(),
      deliveryOtp: this.code(),
      fallbackStage: 'none',
      selfBonusPaise: 0,
      storeToDropM,
      riderPayPaise: 0,
      payLines: [],
      batchedWith: null,
      promisedAt: promisedAt({ readyBy, storeToDropM, bufferMin: sla.etaBufferMin }),
      etaAt: null,
      delayNotifiedAt: null,
      proof: null,
      proofMediaId: null,
      codCollectedPaise: null,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
      requestedAt: now,
      assignedAt: mode === 'self' ? now : null,
      arrivedAt: null,
      arrivedDropAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      failedAt: null,
    });
    if (mode === 'self') {
      await this.sendStaffLink(f, merchant, order);
      return;
    }
    await this.timers.schedule(
      key(f.id, 'fallback'),
      T_FALLBACK,
      new Date(now.getTime() + sla.riderFallbackMin * 60_000),
      { fulfilmentId: f.id },
    );
    await this.search(f.id);
  }

  private async sendStaffLink(
    f: FulfilmentRecord,
    merchant: MerchantRecord,
    order: OrderRecord,
  ): Promise<void> {
    if (!f.staffId || !f.staffToken) return; // the owner delivers; the link is in their app
    const staff = (await this.merchants.staffOf(merchant.id)).find((s) => s.id === f.staffId);
    if (!staff) return;
    await this.notifications.notify(
      'staff.delivery_link',
      { phone: staff.phone },
      { store: merchant.name, code: order.code, link: this.staffLink(f.staffToken) },
      { orderId: order.id, merchantId: merchant.id },
    );
  }

  // ───────────── rider search & offers ─────────────

  /** Offers the fulfilment to the best available rider, or retries in 30 s when nobody is free. */
  async search(fulfilmentId: string): Promise<void> {
    const f = await this.repo.fulfilment(fulfilmentId);
    if (!f || f.state !== 'searching' || f.mode !== 'rider') return;
    const open = (await this.repo.offersFor(f.id)).filter((o) => o.state === 'offered');
    if (open.length) return;
    const c = await this.ctx(f);
    const now = this.clock();
    const standby = f.fallbackStage === 'standby' || f.fallbackStage === 'customer_notified';
    const radius = standby ? STANDBY_RADIUS_M : OFFER_RADIUS_M;
    const tried = new Set((await this.repo.offersFor(f.id)).map((o) => o.riderUserId));
    const online = new Map((await this.repo.riders({ online: true, status: ['approved'] })).map((r) => [r.userId, r]));
    const codDue = c.order.paymentMethod === 'cod' ? Math.max(0, c.order.totalPaise - c.order.refundedPaise) : 0;
    const limit = codDue > 0 ? (await this.config(f.microMarketId)).riderPay.cashLimitPaise : null;
    const candidates: Candidate[] = [];
    for (const pos of await this.locations.near(c.store, radius, now)) {
      const r = online.get(pos.riderId);
      if (!r || tried.has(r.userId)) continue;
      if (!standby && r.zones.length && !r.zones.includes(f.microMarketId)) continue;
      if ((await this.repo.openOffersForRider(r.userId)).length) continue;
      // Cash limit (ADR-032): a rider at the limit gets prepaid orders only.
      if (codDue > 0 && limit != null && (await this.cashInHand(r)) + codDue > limit) continue;
      const jobs = await this.repo.activeFulfilments({ riderUserId: r.userId });
      if (jobs.length >= 2) continue;
      if (jobs.length === 1) {
        const other = await this.ctx(jobs[0]!);
        if (
          jobs[0]!.state !== 'assigned' ||
          !batchEligible({ store: other.store, drop: other.drop }, { store: c.store, drop: c.drop })
        )
          continue;
      }
      candidates.push({
        riderId: r.userId,
        location: pos,
        activeJobs: jobs.length,
        rating: r.rating,
        offersShown: r.offersShown,
        offersAccepted: r.offersAccepted,
      });
    }
    const best = score(candidates, c.store, DEFAULT_WEIGHTS, radius)[0];
    if (!best) {
      await this.timers.schedule(key(f.id, 'retry'), T_RETRY, new Date(now.getTime() + RETRY_SEC * 1000), {
        fulfilmentId: f.id,
      });
      return;
    }
    const { riderPay: payCfg } = await this.config(f.microMarketId);
    const pay = riderPay(payCfg, { tripM: best.distanceM + f.storeToDropM, batched: best.activeJobs === 1 });
    const offer = await this.repo.createOffer({
      id: randomUUID(),
      fulfilmentId: f.id,
      riderUserId: best.riderId,
      state: 'offered',
      payPaise: pay.totalPaise,
      payLines: pay.lines,
      distanceM: best.distanceM,
      offeredAt: now,
      expiresAt: new Date(now.getTime() + OFFER_SEC * 1000),
      respondedAt: null,
    });
    await this.repo.countOffer(best.riderId, false);
    await this.timers.schedule(key(f.id, 'offer'), T_OFFER, offer.expiresAt, { offerId: offer.id });
    this.notifications.toRoom(`user:${best.riderId}`, 'offer.new', {
      offerId: offer.id,
      expiresAt: offer.expiresAt.toISOString(),
    });
    await this.notifications.notify(
      'rider.new_offer',
      { userId: best.riderId },
      { pay: rupees(pay.totalPaise), store: c.merchant.name, distance: km(best.distanceM) },
      { orderId: f.orderId },
      { urgent: true, data: { kind: 'offer', offerId: offer.id } },
    );
  }

  private async onOfferExpired(offerId: string): Promise<void> {
    const o = await this.repo.updateOffer(offerId, 'offered', {
      state: 'expired',
      respondedAt: this.clock(),
    });
    if (o) await this.search(o.fulfilmentId);
  }

  private async riderOffer(riderUserId: string, offerId: string): Promise<OfferRecord> {
    const o = await this.repo.offer(offerId);
    if (!o || o.riderUserId !== riderUserId) throw new DomainError('NOT_FOUND', 'Offer not found');
    return o;
  }

  async acceptOffer(riderUserId: string, offerId: string): Promise<FulfilmentRecord> {
    const o = await this.riderOffer(riderUserId, offerId);
    const me = await this.repo.getRider(riderUserId);
    if (me?.status !== 'approved') throw notApproved(me);
    const now = this.clock();
    if (o.state === 'offered' && now >= o.expiresAt) {
      await this.onOfferExpired(o.id);
      throw new DomainError('OFFER_EXPIRED', 'This offer has expired.');
    }
    if (!(await this.repo.updateOffer(o.id, 'offered', { state: 'accepted', respondedAt: now })))
      throw new DomainError('OFFER_EXPIRED', 'This offer is no longer available.');
    const active = await this.repo.activeFulfilments({ riderUserId });
    const f = await this.repo.updateFulfilment(o.fulfilmentId, 'searching', {
      state: 'assigned',
      riderUserId,
      assignedAt: now,
      riderPayPaise: o.payPaise,
      payLines: o.payLines,
      batchedWith: active[0]?.id ?? null,
    });
    if (!f) {
      await this.repo.updateOffer(o.id, 'accepted', { state: 'withdrawn' });
      throw new DomainError('INVALID_STATE', 'This order was assigned elsewhere.');
    }
    await this.repo.countOffer(riderUserId, true);
    await this.stopTimers(f.id);
    await this.announceAssigned(f);
    return f;
  }

  async declineOffer(riderUserId: string, offerId: string): Promise<void> {
    const o = await this.riderOffer(riderUserId, offerId);
    if (!(await this.repo.updateOffer(o.id, 'offered', { state: 'declined', respondedAt: this.clock() })))
      return;
    await this.timers.cancel(key(o.fulfilmentId, 'offer'));
    await this.search(o.fulfilmentId);
  }

  private async stopTimers(fulfilmentId: string): Promise<void> {
    await Promise.all(
      (['offer', 'retry', 'fallback'] as const).map((t) => this.timers.cancel(key(fulfilmentId, t))),
    );
  }

  private async withdrawOffers(fulfilmentId: string): Promise<void> {
    for (const o of await this.repo.offersFor(fulfilmentId)) {
      if (o.state !== 'offered') continue;
      await this.repo.updateOffer(o.id, 'offered', { state: 'withdrawn', respondedAt: this.clock() });
      this.notifications.toRoom(`user:${o.riderUserId}`, 'offer.withdrawn', { offerId: o.id });
    }
  }

  private async announceAssigned(f: FulfilmentRecord): Promise<void> {
    const c = await this.ctx(f);
    const courier = await this.courier(f);
    const update = {
      orderId: f.orderId,
      code: c.order.code,
      type: 'fulfilment.assigned',
      state: c.order.state,
    };
    this.notifications.toRoom(`user:${c.order.userId}`, 'order.updated', update);
    this.notifications.toRoom(`merchant:${f.merchantId}`, 'order.updated', update);
    if (f.riderUserId)
      this.notifications.toRoom(`user:${f.riderUserId}`, 'job.updated', { fulfilmentId: f.id });
    if (f.mode === 'rider')
      await this.notifications.notify(
        'merchant.rider_assigned',
        { userId: c.merchant.ownerUserId },
        { code: c.order.code, name: courier?.name ?? '', pickup: f.pickupCode },
        { orderId: f.orderId, merchantId: f.merchantId },
      );
  }

  // ───────────── fallback ladder ─────────────

  async fallback(fulfilmentId: string): Promise<void> {
    const f = await this.repo.fulfilment(fulfilmentId);
    if (!f || f.state !== 'searching') return;
    const stage = nextFallbackStage(f.fallbackStage);
    if (!stage) return;
    const now = this.clock();
    const next = new Date(now.getTime() + FALLBACK_STEP_MIN * 60_000);
    const c = await this.ctx(f);
    await this.repo.updateFulfilment(f.id, 'searching', { fallbackStage: stage });
    this.logger.log({ orderId: f.orderId, stage }, 'dispatch fallback');
    if (stage === 'tpl') {
      const r = await this.threePl.book({
        orderId: f.orderId,
        pickup: { ...c.store, name: c.merchant.name },
        drop: c.drop,
        readyAt: c.order.packBy ?? now,
      });
      if (r.booked) {
        await this.withdrawOffers(f.id);
        const booked = await this.repo.updateFulfilment(f.id, 'searching', {
          mode: 'tpl',
          state: 'assigned',
          tplRef: r.ref,
          assignedAt: now,
        });
        if (booked) {
          await this.stopTimers(f.id);
          await this.announceAssigned(booked);
          return;
        }
      }
    } else if (stage === 'self_bonus') {
      await this.repo.updateFulfilment(f.id, 'searching', { selfBonusPaise: SELF_DELIVERY_BONUS_PAISE });
      await this.notifications.notify(
        'merchant.self_delivery_bonus',
        { userId: c.merchant.ownerUserId },
        { code: c.order.code, bonus: rupees(SELF_DELIVERY_BONUS_PAISE) },
        { orderId: f.orderId, merchantId: f.merchantId },
        { urgent: true },
      );
      this.notifications.toRoom(`merchant:${f.merchantId}`, 'order.updated', {
        orderId: f.orderId,
        code: c.order.code,
        type: 'fulfilment.self_bonus',
        state: c.order.state,
      });
    } else if (stage === 'standby') {
      await this.search(f.id);
    } else if (stage === 'customer_notified') {
      const eta = new Date(now.getTime() + (15 + travelMin(f.storeToDropM)) * 60_000);
      await this.repo.updateFulfilment(f.id, 'searching', { etaAt: eta });
      await this.notifications.notify(
        'customer.finding_courier',
        { userId: c.order.userId },
        { code: c.order.code, eta: istClock(eta) },
        { orderId: f.orderId, merchantId: f.merchantId },
        { whatsapp: true },
      );
      this.notifications.toRoom(`user:${c.order.userId}`, 'order.updated', {
        orderId: f.orderId,
        code: c.order.code,
        type: 'fulfilment.delayed',
        state: c.order.state,
      });
      return; // the search keeps retrying; the customer may cancel
    }
    await this.timers.schedule(key(f.id, 'fallback'), T_FALLBACK, next, { fulfilmentId: f.id });
  }

  // ───────────── store / ops overrides ─────────────

  /** The store delivers after all (fallback bonus, or its own choice while still searching); ops may force it. */
  async switchToSelf(
    orderId: string,
    staffId: string | null,
    by: { ownerUserId?: string; ops?: OpsActor },
  ): Promise<FulfilmentRecord> {
    const f = await this.fulfilmentOrThrow(orderId);
    const c = await this.ctx(f);
    if (by.ownerUserId && c.merchant.ownerUserId !== by.ownerUserId)
      throw new DomainError('NOT_FOUND', 'Order not found');
    if (f.mode === 'self')
      throw new DomainError('INVALID_STATE', 'This order is already delivered by the store.');
    if (staffId && !(await this.merchants.staffOf(f.merchantId)).some((s) => s.id === staffId && s.active))
      throw new DomainError('VALIDATION_FAILED', 'Choose one of your staff members.', { field: 'staffId' });
    const allowed = by.ops ? (['searching', 'assigned'] as const) : (['searching'] as const);
    await this.withdrawOffers(f.id);
    const prevRider = f.riderUserId;
    const next = await this.repo.updateFulfilment(f.id, allowed, {
      mode: 'self',
      state: 'assigned',
      staffId,
      staffToken: this.token(),
      riderUserId: null,
      tplRef: null,
      riderPayPaise: 0,
      payLines: [],
      assignedAt: this.clock(),
    });
    if (!next) throw new DomainError('INVALID_STATE', 'A courier already has this order.');
    if (by.ops)
      await this.repo.appendAudit({
        entity: 'order',
        entityId: orderId,
        action: 'dispatch.forced_self',
        actorId: by.ops.userId,
        requestId: by.ops.requestId,
        microMarketId: f.microMarketId,
        before: { mode: f.mode, state: f.state, riderUserId: f.riderUserId },
        after: { mode: 'self', staffId },
      });
    await this.stopTimers(f.id);
    if (prevRider)
      this.notifications.toRoom(`user:${prevRider}`, 'job.updated', { fulfilmentId: f.id, removed: true });
    await this.sendStaffLink(next, c.merchant, c.order);
    await this.announceAssigned(next);
    return next;
  }

  /** Ops: give the order to a specific online rider (before pickup). */
  async reassign(orderId: string, riderUserId: string, actor: OpsActor): Promise<FulfilmentRecord> {
    const f = await this.fulfilmentOrThrow(orderId);
    const rider = await this.repo.getRider(riderUserId);
    if (!rider) throw new DomainError('NOT_FOUND', 'Rider not found');
    if (rider.status !== 'approved')
      throw new DomainError('VALIDATION_FAILED', 'This rider is not approved.', { field: 'riderUserId' });
    if (!rider.online)
      throw new DomainError('VALIDATION_FAILED', 'This rider is offline.', { field: 'riderUserId' });
    await this.withdrawOffers(f.id);
    const c = await this.ctx(f);
    const pos = await this.locations.get(riderUserId);
    const { riderPay: payCfg } = await this.config(f.microMarketId);
    const pay = riderPay(payCfg, {
      tripM: (pos ? Math.round(haversineM(pos, c.store)) : 0) + f.storeToDropM,
    });
    const prev = f.riderUserId;
    const next = await this.repo.updateFulfilment(f.id, ['searching', 'assigned'], {
      mode: 'rider',
      state: 'assigned',
      riderUserId,
      staffId: null,
      tplRef: null,
      assignedAt: this.clock(),
      riderPayPaise: pay.totalPaise,
      payLines: pay.lines,
    });
    if (!next) throw new DomainError('INVALID_STATE', 'This order was already picked up.');
    await this.repo.appendAudit({
      entity: 'order',
      entityId: orderId,
      action: 'dispatch.reassigned',
      actorId: actor.userId,
      requestId: actor.requestId,
      microMarketId: f.microMarketId,
      before: { mode: f.mode, state: f.state, riderUserId: prev },
      after: { mode: 'rider', riderUserId },
    });
    await this.stopTimers(f.id);
    if (prev && prev !== riderUserId)
      this.notifications.toRoom(`user:${prev}`, 'job.updated', { fulfilmentId: f.id, removed: true });
    await this.announceAssigned(next);
    return next;
  }

  private async fulfilmentOrThrow(orderId: string): Promise<FulfilmentRecord> {
    const f = await this.repo.fulfilmentForOrder(orderId);
    if (!f) throw new DomainError('NOT_FOUND', 'No delivery for this order yet');
    return f;
  }

  // ───────────── courier actions (rider app and staff link) ─────────────

  async riderJob(riderUserId: string, fulfilmentId: string): Promise<FulfilmentRecord> {
    const f = await this.repo.fulfilment(fulfilmentId);
    if (!f || f.riderUserId !== riderUserId) throw new DomainError('NOT_FOUND', 'Job not found');
    return f;
  }

  async staffJob(token: string): Promise<FulfilmentRecord> {
    const f = await this.repo.fulfilmentByToken(token);
    if (!f || f.mode !== 'self') throw new DomainError('NOT_FOUND', 'This delivery link is not valid.');
    return f;
  }

  async arrived(f: FulfilmentRecord): Promise<FulfilmentRecord> {
    if (f.arrivedAt || f.state !== 'assigned') return f;
    return (await this.repo.updateFulfilment(f.id, 'assigned', { arrivedAt: this.clock() })) ?? f;
  }

  /** The rider is at the customer's door: the customer is told, and the app starts a waiting timer (ADR-030). */
  async arrivedDrop(f: FulfilmentRecord): Promise<FulfilmentRecord> {
    if (f.arrivedDropAt || f.state !== 'picked_up') return f;
    const next = await this.repo.updateFulfilment(f.id, 'picked_up', { arrivedDropAt: this.clock() });
    if (!next) return f;
    const c = await this.ctx(next);
    await this.notifications.notify(
      'customer.courier_arrived',
      { userId: c.order.userId },
      { code: c.order.code },
      { orderId: f.orderId, merchantId: f.merchantId },
      { data: { kind: 'order', orderId: f.orderId } },
    );
    this.notifications.toRoom(`user:${c.order.userId}`, 'order.updated', { orderId: f.orderId, type: 'fulfilment.arrived_drop' });
    return next;
  }

  /**
   * Door photo instead of the OTP (ADR-030): only prepaid orders up to PHOTO_PROOF_MAX_PAISE, and only after the
   * rider marked "arrived at the customer". Cash orders always need the OTP (the cash is handed over anyway).
   */
  photoProofAllowed(order: { paymentMethod: string; totalPaise: number }): boolean {
    return order.paymentMethod !== 'cod' && order.totalPaise <= PHOTO_PROOF_MAX_PAISE;
  }

  async pickedUp(
    f: FulfilmentRecord,
    actor: 'rider' | 'staff',
    actorId: string | null,
    pickupCode?: string,
  ): Promise<FulfilmentRecord> {
    if (f.state !== 'assigned')
      throw new DomainError('INVALID_STATE', 'This delivery is not waiting for pickup.', { state: f.state });
    if (actor === 'rider' && pickupCode !== f.pickupCode)
      throw new DomainError(
        'WRONG_CODE',
        'That pickup code is not right. Ask the store for the code on its order card.',
      );
    const c = await this.ctx(f);
    if (c.order.state === 'ACCEPTED' || c.order.state === 'PREPARING')
      throw new DomainError('NOT_READY', 'The store is still packing this order.');
    if (c.order.state !== 'READY')
      throw new DomainError('INVALID_STATE', 'This order cannot be picked up.', { state: c.order.state });
    const now = this.clock();
    if (!(await this.orders.move(c.order, 'PICKED_UP', actor, actorId, 'picked_up')))
      throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    const picked = (await this.orders.get(f.orderId))!;
    await this.orders.move(picked, 'OUT_FOR_DELIVERY', 'system', null, 'on_the_way');
    const next = (await this.repo.updateFulfilment(f.id, 'assigned', {
      state: 'picked_up',
      pickedUpAt: now,
      arrivedAt: f.arrivedAt ?? now,
    }))!;
    const courier = await this.courier(next);
    await this.notifications.notify(
      'customer.out_for_delivery',
      { userId: c.order.userId },
      { name: courier?.name ?? '', code: c.order.code, otp: f.deliveryOtp },
      { orderId: f.orderId, merchantId: f.merchantId },
      { whatsapp: true },
    );
    return next;
  }

  async delivered(
    f: FulfilmentRecord,
    actor: 'rider' | 'staff',
    actorId: string | null,
    proof: {
      otp?: string | undefined;
      photoMediaId?: string | undefined;
      codCollectedPaise?: number | undefined;
    },
  ): Promise<FulfilmentRecord> {
    if (f.state !== 'picked_up')
      throw new DomainError('INVALID_STATE', 'Pick up the order first.', { state: f.state });
    const c = await this.ctx(f);
    if (proof.photoMediaId) {
      // Audit B1 / ADR-030: the photo must be this rider's door photo for this job, and photo proof must apply.
      if (actor !== 'rider' || !actorId)
        throw new DomainError('VALIDATION_FAILED', 'Ask the customer for the 4-digit OTP in their app.', { field: 'otp' });
      if (!this.photoProofAllowed(c.order))
        throw new DomainError('VALIDATION_FAILED', "This order needs the customer's OTP.", { field: 'otp' });
      if (!f.arrivedDropAt)
        throw new DomainError('INVALID_STATE', 'Mark "Arrived at the customer" first.');
      await this.photos.deliveryProof(actorId, f.id, proof.photoMediaId);
    } else if (proof.otp !== f.deliveryOtp)
      throw new DomainError(
        'WRONG_CODE',
        'That OTP is not right. Ask the customer for the 4-digit code in their app.',
      );
    const codDue =
      c.order.paymentMethod === 'cod' ? Math.max(0, c.order.totalPaise - c.order.refundedPaise) : 0;
    if (codDue > 0 && proof.codCollectedPaise === undefined)
      throw new DomainError('VALIDATION_FAILED', 'Enter the cash collected.', { field: 'codCollectedPaise' });
    if (
      !(await this.orders.move(
        c.order,
        'DELIVERED',
        actor,
        actorId,
        proof.photoMediaId ? 'delivered_photo' : 'delivered_otp',
      ))
    )
      throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    const now = this.clock();
    let payLines: PayLine[] = f.payLines;
    let pay = f.riderPayPaise;
    if (f.mode === 'rider' && f.arrivedAt && f.pickedUpAt) {
      const { riderPay: cfg } = await this.config(f.microMarketId);
      const waitMin = (f.pickedUpAt.getTime() - f.arrivedAt.getTime()) / 60_000;
      const extra = riderPay(cfg, { tripM: 0, waitMin }).lines.find((l) => l.code === 'wait');
      if (extra && !payLines.some((l) => l.code === 'wait')) {
        payLines = [...payLines, extra];
        pay += extra.amountPaise;
      }
    }
    // The customer's tip goes 100% to the rider (ADR-032). Store staff: credited to the store at settlement.
    const tip = c.order.tipPaise ?? 0;
    if (f.mode === 'rider' && tip > 0 && !payLines.some((l) => l.code === 'tip')) {
      payLines = [...payLines, { code: 'tip', amountPaise: tip }];
      pay += tip;
    }
    const next = (await this.repo.updateFulfilment(f.id, 'picked_up', {
      state: 'delivered',
      deliveredAt: now,
      proof: proof.photoMediaId ? 'photo' : 'otp',
      proofMediaId: proof.photoMediaId ?? null,
      codCollectedPaise: codDue > 0 ? (proof.codCollectedPaise ?? null) : null,
      riderPayPaise: pay,
      payLines,
    }))!;
    await this.notifications.notify(
      'customer.order_delivered',
      { userId: c.order.userId },
      { code: c.order.code, store: c.merchant.name },
      { orderId: f.orderId, merchantId: f.merchantId },
      { whatsapp: true },
    );
    return next;
  }

  // ───────────── couldn't deliver (ADR-026) ─────────────

  /**
   * The courier could not hand the order over (no answer, wrong address, refused, unsafe). The order waits
   * as FAILED_DELIVERY with the courier until they try again (the customer called back) or ops cancel it.
   */
  async failed(
    f: FulfilmentRecord,
    actor: 'rider' | 'staff',
    actorId: string | null,
    reason: (typeof FAILED_REASONS)[number],
    note?: string,
  ): Promise<FulfilmentRecord> {
    if (f.state !== 'picked_up')
      throw new DomainError('INVALID_STATE', 'Only an order on its way can be marked as not delivered.', { state: f.state });
    const c = await this.ctx(f);
    if (!(await this.orders.move(c.order, 'FAILED_DELIVERY', actor, actorId, `failed_${reason}`, { outcomeReason: `delivery_failed_${reason}` })))
      throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    const next = (await this.repo.updateFulfilment(f.id, 'picked_up', { state: 'failed', failedAt: this.clock() }))!;
    await this.repo.appendAudit({
      entity: 'order',
      entityId: f.orderId,
      action: 'dispatch.delivery_failed',
      actorId: actor === 'rider' ? actorId : null,
      requestId: null,
      microMarketId: f.microMarketId,
      before: { state: 'picked_up' },
      after: { state: 'failed', reason, note: note ?? null, by: actor },
    });
    await this.notifications.notify(
      'customer.delivery_failed',
      { userId: c.order.userId },
      { code: c.order.code, store: c.merchant.name },
      { orderId: f.orderId, merchantId: f.merchantId },
      { whatsapp: true, urgent: true },
    );
    await this.notifications.notify(
      'merchant.delivery_failed',
      { userId: c.merchant.ownerUserId },
      { code: c.order.code },
      { orderId: f.orderId, merchantId: f.merchantId },
    );
    return next;
  }

  /** Back on the way after a failed attempt: by the courier (the customer called back) or by ops. */
  async retryDelivery(f: FulfilmentRecord, actor: 'rider' | 'staff' | 'ops', actorId: string | null, ops?: OpsActor): Promise<FulfilmentRecord> {
    if (f.state !== 'failed') throw new DomainError('INVALID_STATE', 'This delivery has not failed.', { state: f.state });
    const c = await this.ctx(f);
    if (c.order.state !== 'FAILED_DELIVERY')
      throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.', { state: c.order.state });
    if (!(await this.orders.move(c.order, 'OUT_FOR_DELIVERY', actor, actorId, 'retry_delivery', { outcomeReason: null })))
      throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    const next = (await this.repo.updateFulfilment(f.id, 'failed', { state: 'picked_up', failedAt: null }))!;
    if (ops)
      await this.repo.appendAudit({
        entity: 'order',
        entityId: f.orderId,
        action: 'dispatch.delivery_retried',
        actorId: ops.userId,
        requestId: ops.requestId,
        microMarketId: f.microMarketId,
        before: { state: 'failed' },
        after: { state: 'picked_up' },
      });
    const courier = await this.courier(next);
    await this.notifications.notify(
      'customer.out_for_delivery',
      { userId: c.order.userId },
      { name: courier?.name ?? '', code: c.order.code, otp: f.deliveryOtp },
      { orderId: f.orderId, merchantId: f.merchantId },
      { whatsapp: true },
    );
    if (actor === 'ops' && f.riderUserId) this.notifications.toRoom(`user:${f.riderUserId}`, 'job.updated', { fulfilmentId: f.id });
    return next;
  }

  /** Ops end a failed delivery: cancelled, refunded only if they say so (audited). */
  async cancelFailed(orderId: string, refund: boolean, reason: string, ops: OpsActor): Promise<void> {
    const f = await this.fulfilmentOrThrow(orderId);
    if (f.state !== 'failed') throw new DomainError('INVALID_STATE', 'This delivery has not failed.', { state: f.state });
    await this.lifecycle.cancelFailedDelivery(orderId, ops.userId, refund, reason);
    await this.repo.appendAudit({
      entity: 'order',
      entityId: orderId,
      action: 'dispatch.failed_delivery_cancelled',
      actorId: ops.userId,
      requestId: ops.requestId,
      microMarketId: f.microMarketId,
      before: { state: 'failed' },
      after: { state: 'cancelled', refund, reason },
    });
  }

  // ───────────── live location & ETA ─────────────

  async riderLocation(riderUserId: string, p: LatLng): Promise<void> {
    const now = this.clock();
    await this.locations.set(riderUserId, p, now);
    await this.repo.updateRider(riderUserId, { lastSeenAt: now });
    for (const f of await this.repo.activeFulfilments({ riderUserId }))
      if (f.state !== 'searching') await this.track(f, p);
  }

  async staffLocation(f: FulfilmentRecord, p: LatLng): Promise<void> {
    if (f.state === 'assigned' || f.state === 'picked_up') await this.track(f, p);
  }

  private async track(f: FulfilmentRecord, p: LatLng): Promise<void> {
    const c = await this.ctx(f);
    const now = this.clock();
    const eta = liveEta({
      now,
      courier: p,
      store: c.store,
      drop: c.drop,
      pickedUp: f.state === 'picked_up',
      readyAt: c.order.readyAt ?? c.order.packBy,
    });
    const late = eta.getTime() > f.promisedAt.getTime() + DELAY_NOTICE_MIN * 60_000;
    const notify = late && !f.delayNotifiedAt;
    await this.repo.updateFulfilment(f.id, null, {
      lastLat: p.lat,
      lastLng: p.lng,
      lastLocationAt: now,
      etaAt: eta,
      ...(notify ? { delayNotifiedAt: now } : {}),
    });
    this.notifications.toRoom(`user:${c.order.userId}`, 'order.location', {
      orderId: f.orderId,
      lat: p.lat,
      lng: p.lng,
      etaAt: eta.toISOString(),
    });
    if (notify)
      await this.notifications.notify(
        'customer.delivery_delayed',
        { userId: c.order.userId },
        { code: c.order.code, eta: istClock(eta) },
        { orderId: f.orderId, merchantId: f.merchantId },
        { whatsapp: true },
      );
  }

  // ───────────── riders ─────────────

  async setStatus(userId: string, online: boolean, zones: string[] | undefined): Promise<RiderRecord> {
    const me = await this.auth.me(userId);
    let r = await this.repo.getRider(userId);
    r ??= await this.repo.upsertRider({ userId, name: me.name ?? 'Rider' });
    const now = this.clock();
    if (online && r.status !== 'approved') throw notApproved(r);
    // Going offline mid-delivery would stop the customer's live tracking (audit B3).
    if (!online && (await this.repo.activeFulfilments({ riderUserId: userId })).length)
      throw new DomainError('RIDER_HAS_ACTIVE_JOB', 'Finish your delivery before going offline.');
    if (online) {
      return (await this.repo.updateRider(userId, {
        online: true,
        zones: zones ?? r.zones,
        onlineSince: r.online ? r.onlineSince : now,
        lastSeenAt: now,
      }))!;
    }
    const today = istDayStart(now);
    const since = r.onlineSince && r.onlineSince > today ? r.onlineSince : today;
    const carried = r.onlineSince && r.onlineSince > today ? r.onlineMinToday : 0;
    const minutes = r.online
      ? carried + Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000))
      : r.onlineMinToday;
    await this.locations.remove(userId);
    for (const o of await this.repo.openOffersForRider(userId)) {
      if (await this.repo.updateOffer(o.id, 'offered', { state: 'declined', respondedAt: now }))
        await this.search(o.fulfilmentId);
    }
    return (await this.repo.updateRider(userId, {
      online: false,
      onlineSince: now,
      onlineMinToday: minutes,
    }))!;
  }

  async rider(userId: string): Promise<RiderRecord> {
    const me = await this.auth.me(userId);
    return (await this.repo.getRider(userId)) ?? this.repo.upsertRider({ userId, name: me.name ?? 'Rider' });
  }

  openOffers(userId: string): Promise<OfferRecord[]> {
    return this.repo.openOffersForRider(userId);
  }

  activeJobs(userId: string): Promise<FulfilmentRecord[]> {
    return this.repo.activeFulfilments({ riderUserId: userId });
  }

  async onlineMinutes(r: RiderRecord): Promise<number> {
    const now = this.clock();
    const today = istDayStart(now);
    const carried = r.onlineSince && r.onlineSince >= today ? r.onlineMinToday : 0;
    if (!r.online || !r.onlineSince) return carried;
    const since = r.onlineSince > today ? r.onlineSince : today;
    return carried + Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  }

  /**
   * COD cash the rider collected in the current payout period (today for daily payouts, this IST week for
   * weekly). The next payout deducts it, so this is what they should hand over or expect to net off.
   */
  async cashInHand(r: Pick<RiderRecord, 'userId' | 'payoutCadence'>): Promise<number> {
    const since = r.payoutCadence === 'daily' ? istDayStart(this.clock()) : istWeekStart(this.clock());
    const delivered = await this.repo.deliveredForRider(r.userId, since);
    const collected = delivered.filter((f) => f.mode === 'rider').reduce((s, f) => s + (f.codCollectedPaise ?? 0), 0);
    // Cash already handed over to Santha this period (ADR-032).
    const deposited = (await this.repo.deposits(r.userId, since)).reduce((s, d) => s + d.amountPaise, 0);
    return Math.max(0, collected - deposited);
  }

  /**
   * Rider pay rules for a rider (cash limit, incentives): the first micro-market they work in, else the first one.
   * Riders work in one city at pilot scale, so one config applies to all their deliveries.
   */
  async riderPayFor(r: Pick<RiderRecord, 'zones'>) {
    const id = r.zones[0] ?? (await this.markets.list())[0]?.market.id;
    return id ? (await this.config(id)).riderPay : RiderPaySchema.parse(DEFAULT_CONFIG.riderPay);
  }

  /** Progress on each incentive (ADR-032): deliveries today / this IST week against the targets. */
  async incentives(r: RiderRecord): Promise<Array<{ period: 'day' | 'week'; deliveries: number; bonusPaise: number; done: number; achieved: boolean }>> {
    const cfg = await this.riderPayFor(r);
    if (!cfg.incentives.length) return [];
    const delivered = (await this.repo.deliveredForRider(r.userId, istWeekStart(this.clock()))).filter((f) => f.mode === 'rider');
    const today = istDayStart(this.clock());
    const count = { day: delivered.filter((f) => f.deliveredAt! >= today).length, week: delivered.length };
    return cfg.incentives.map((i) => ({ ...i, done: Math.min(count[i.period], i.deliveries), achieved: count[i.period] >= i.deliveries }));
  }

  /** Incentive bonuses earned in [start, end) (settlement): each day's daily targets, plus weekly targets per IST week. */
  async incentivesEarned(r: RiderRecord, start: Date, end: Date): Promise<Array<{ period: 'day' | 'week'; deliveries: number; bonusPaise: number; date: string }>> {
    const cfg = await this.riderPayFor(r);
    if (!cfg.incentives.length) return [];
    const delivered = (await this.repo.deliveredForRider(r.userId, start)).filter((f) => f.mode === 'rider' && f.deliveredAt! < end);
    const out: Array<{ period: 'day' | 'week'; deliveries: number; bonusPaise: number; date: string }> = [];
    const date = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
    for (let day = istDayStart(start); day < end; day = new Date(day.getTime() + 86_400_000)) {
      const next = new Date(day.getTime() + 86_400_000);
      const n = delivered.filter((f) => f.deliveredAt! >= day && f.deliveredAt! < next).length;
      for (const i of cfg.incentives) if (i.period === 'day' && n >= i.deliveries) out.push({ ...i, date: date(day) });
    }
    // A weekly target counts only for a whole Mon–Sun week inside the period.
    for (let wk = istWeekStart(start); wk < end; wk = new Date(wk.getTime() + 7 * 86_400_000)) {
      const wkEnd = new Date(wk.getTime() + 7 * 86_400_000);
      if (wk < start || wkEnd > end) continue;
      const n = delivered.filter((f) => f.deliveredAt! >= wk && f.deliveredAt! < wkEnd).length;
      for (const i of cfg.incentives) if (i.period === 'week' && n >= i.deliveries) out.push({ ...i, date: date(wk) });
    }
    return out;
  }

  /** Ops record cash the rider handed over (ADR-032); audited. */
  async recordDeposit(riderUserId: string, amountPaise: number, note: string | null, actor: OpsActor) {
    const r = await this.repo.getRider(riderUserId);
    if (!r) throw new DomainError('NOT_FOUND', 'Rider not found');
    const d = await this.repo.createDeposit({ id: randomUUID(), riderUserId, amountPaise, note, recordedBy: actor.userId });
    await this.repo.appendAudit({
      entity: 'rider',
      entityId: riderUserId,
      action: 'rider.cash_deposit',
      actorId: actor.userId,
      requestId: actor.requestId,
      after: { amountPaise, note },
    });
    return d;
  }

  depositsFor(riderUserId: string, start: Date, end: Date) {
    return this.repo.deposits(riderUserId, start).then((ds) => ds.filter((d) => d.createdAt < end));
  }

  /** The last 7 IST days including today, oldest first: deliveries, pay and COD cash per day. */
  async earningsWeek(userId: string): Promise<Array<{ date: string; deliveries: number; earnedPaise: number; cashPaise: number }>> {
    const today = istDayStart(this.clock());
    const since = new Date(today.getTime() - 6 * 86_400_000);
    const delivered = (await this.repo.deliveredForRider(userId, since)).filter((f) => f.mode === 'rider');
    return Array.from({ length: 7 }, (_, i) => {
      const start = new Date(since.getTime() + i * 86_400_000);
      const end = new Date(start.getTime() + 86_400_000);
      const day = delivered.filter((f) => f.deliveredAt! >= start && f.deliveredAt! < end);
      return {
        date: new Date(start.getTime() + IST_MS).toISOString().slice(0, 10),
        deliveries: day.length,
        earnedPaise: day.reduce((s, f) => s + f.riderPayPaise, 0),
        cashPaise: day.reduce((s, f) => s + (f.codCollectedPaise ?? 0), 0),
      };
    });
  }

  // ───────────── SOS (ADR-031) ─────────────

  /**
   * The rider pressed SOS: one open alert per rider (pressing again returns it), with the delivery in hand and
   * the best position we have. Ops see it on the live board until they resolve it. Audited.
   */
  async sos(riderUserId: string, input: { lat?: number | undefined; lng?: number | undefined; called112?: boolean | undefined }): Promise<RiderSosRecord> {
    const open = (await this.repo.openSos(riderUserId))[0];
    if (open) return open;
    const job = (await this.repo.activeFulfilments({ riderUserId }))[0] ?? null;
    const pos = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : await this.locations.get(riderUserId);
    const s = await this.repo.createSos({
      id: randomUUID(),
      riderUserId,
      fulfilmentId: job?.id ?? null,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      called112: !!input.called112,
    });
    await this.repo.appendAudit({
      entity: 'rider',
      entityId: riderUserId,
      action: 'rider.sos',
      actorId: riderUserId,
      after: { sosId: s.id, fulfilmentId: s.fulfilmentId, called112: s.called112, lat: s.lat, lng: s.lng },
    });
    this.logger.warn({ sosId: s.id, riderUserId, fulfilmentId: s.fulfilmentId }, 'rider SOS');
    // Page the on-call phones without making the rider wait for the SMS and call providers (ADR-034).
    void this.pageSos(s.id, 'first').catch((err: Error) => this.logger.error({ sosId: s.id, err: err.message }, 'SOS page failed'));
    return s;
  }

  /**
   * SMS + automated call to the on-call phones (OPS_ALERT_PHONES). The first page goes out when the SOS is raised;
   * if it is still open after OPS_SOS_REPAGE_SEC the same phones are paged once more (ADR-034).
   */
  private async pageSos(sosId: string, round: 'first' | 'again'): Promise<void> {
    const s = await this.repo.sos(sosId);
    if (!s || s.resolvedAt) return;
    if (!this.notifications.onCallPhones().length) {
      this.logger.warn({ sosId }, 'rider SOS raised but OPS_ALERT_PHONES is empty: nobody was paged');
      return;
    }
    const rider = await this.rider(s.riderUserId);
    const phone = (await this.auth.me(s.riderUserId)).phone;
    const job = s.fulfilmentId ? await this.repo.fulfilment(s.fulfilmentId) : null;
    const order = job ? await this.orders.get(job.orderId) : null;
    const where = [order ? `Order ${order.code}.` : 'No delivery in hand.', s.lat != null && s.lng != null ? `Map: https://maps.google.com/?q=${s.lat},${s.lng}.` : 'No location.'].join(' ');
    const minutes = Math.max(1, Math.round((this.clock().getTime() - s.createdAt.getTime()) / 60_000));
    const reached = await this.notifications.pageOnCall(round === 'first' ? 'ops.rider_sos' : 'ops.rider_sos_again', { rider: rider.name, phone, where, minutes }, { userId: s.riderUserId });
    await this.repo.markSosPaged(sosId, reached, this.clock());
    if (round === 'first' && this.env.OPS_SOS_REPAGE_SEC > 0)
      await this.timers.schedule(`sos:${sosId}`, T_SOS_REPAGE, new Date(this.clock().getTime() + this.env.OPS_SOS_REPAGE_SEC * 1000), { sosId });
  }

  async resolveSos(id: string, actor: OpsActor, note: string | null): Promise<RiderSosRecord> {
    const s = await this.repo.sos(id);
    if (!s) throw new DomainError('NOT_FOUND', 'Alert not found');
    const done = await this.repo.resolveSos(id, actor.userId, note, this.clock());
    if (!done) throw new DomainError('INVALID_STATE', 'This alert was already resolved.');
    await this.timers.cancel(`sos:${id}`);
    await this.repo.appendAudit({
      entity: 'rider',
      entityId: s.riderUserId,
      action: 'rider.sos_resolved',
      actorId: actor.userId,
      requestId: actor.requestId,
      before: { sosId: id },
      after: { note },
    });
    return done;
  }

  /** How many on-call phones are set to be paged for an SOS. */
  onCallPhoneCount(): number {
    return this.notifications.onCallPhones().length;
  }

  openSos(): Promise<RiderSosRecord[]> {
    return this.repo.openSos();
  }

  async earnings(userId: string): Promise<{ deliveries: FulfilmentRecord[]; totalPaise: number }> {
    const deliveries = await this.repo.deliveredForRider(userId, istDayStart(this.clock()));
    return { deliveries, totalPaise: deliveries.reduce((s, f) => s + f.riderPayPaise, 0) };
  }

  // ───────────── views for other parties ─────────────

  fulfilmentById(id: string): Promise<FulfilmentRecord | null> {
    return this.repo.fulfilment(id);
  }

  fulfilmentForOrder(orderId: string): Promise<FulfilmentRecord | null> {
    return this.repo.fulfilmentForOrder(orderId);
  }

  context(f: FulfilmentRecord): Promise<Ctx> {
    return this.ctx(f);
  }

  async courier(f: FulfilmentRecord): Promise<Courier | null> {
    if (f.mode === 'tpl') return f.tplRef ? { kind: 'tpl', name: 'Partner courier' } : null;
    if (f.mode === 'rider')
      return f.riderUserId
        ? { kind: 'rider', name: (await this.repo.getRider(f.riderUserId))?.name ?? 'Rider' }
        : null;
    if (f.staffId) {
      const s = (await this.merchants.staffOf(f.merchantId)).find((x) => x.id === f.staffId);
      if (s) return { kind: 'staff', name: s.name };
    }
    return { kind: 'owner', name: (await this.merchants.record(f.merchantId)).name };
  }

  callNumber(
    orderId: string,
    from: 'customer' | 'courier' | 'store',
    to: 'customer' | 'courier' | 'store',
  ): Promise<string> {
    return this.calls.proxyNumber(orderId, from, to);
  }

  async cancelForNoCourier(userId: string, orderId: string): Promise<void> {
    const f = await this.fulfilmentOrThrow(orderId);
    if (f.state !== 'searching' || f.fallbackStage !== 'customer_notified')
      throw new DomainError(
        'INVALID_STATE',
        'A delivery partner is on the way; this order can no longer be cancelled here.',
      );
    await this.lifecycle.cancelForNoCourier(userId, orderId);
  }

  activeAll(): Promise<FulfilmentRecord[]> {
    return this.repo.activeFulfilments();
  }

  ridersAll(): Promise<RiderRecord[]> {
    return this.repo.riders();
  }

  positions() {
    return this.locations.all(this.clock());
  }

  deliveredForRider(riderUserId: string, since: Date): Promise<FulfilmentRecord[]> {
    return this.repo.deliveredForRider(riderUserId, since);
  }

  /** Ratings (M7) keep the rider's average up to date; scoring uses it. */
  async setRiderRating(riderUserId: string, rating: number): Promise<void> {
    await this.repo.updateRider(riderUserId, { rating: Math.round(rating * 100) / 100 });
  }

  deliveredForMerchant(merchantId: string, since: Date): Promise<FulfilmentRecord[]> {
    return this.repo.deliveredForMerchant(merchantId, since);
  }

  merchantFees(microMarketId: string) {
    return this.config(microMarketId).then((c) => c.fees);
  }

  now(): Date {
    return this.clock();
  }

  // ───────────── order events ─────────────

  private async onReady(e: DomainEvent): Promise<void> {
    const f = await this.repo.fulfilmentForOrder(e.aggregate.id);
    if (f?.riderUserId)
      this.notifications.toRoom(`user:${f.riderUserId}`, 'job.updated', { fulfilmentId: f.id, ready: true });
  }

  private async onCancelled(e: DomainEvent): Promise<void> {
    const f = await this.repo.fulfilmentForOrder(e.aggregate.id);
    if (!f || !ACTIVE_STATES.includes(f.state)) return;
    await this.withdrawOffers(f.id);
    await this.stopTimers(f.id);
    await this.repo.updateFulfilment(f.id, ACTIVE_STATES, { state: 'cancelled' });
    if (f.riderUserId)
      this.notifications.toRoom(`user:${f.riderUserId}`, 'job.updated', {
        fulfilmentId: f.id,
        removed: true,
      });
  }
}

const rupees = (paise: number) => `₹${(paise / 100).toFixed(paise % 100 === 0 ? 0 : 2)}`;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
/** "1:05 pm" in IST. */
export function istClock(d: Date): string {
  const t = new Date(d.getTime() + IST_MS);
  const h = t.getUTCHours();
  return `${h % 12 || 12}:${String(t.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
