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
import {
  ACTIVE_STATES,
  DispatchRepository,
  type FulfilmentRecord,
  type OfferRecord,
  type RiderRecord,
} from './dispatch.repository';
import { RiderLocations } from './rider-locations';

export const OFFER_SEC = 30;
const RETRY_SEC = 30;
const T_OFFER = 'dispatch.offer_expired';
const T_RETRY = 'dispatch.search_retry';
const T_FALLBACK = 'dispatch.fallback';
const key = (fulfilmentId: string, t: 'offer' | 'retry' | 'fallback') => `fulfilment:${fulfilmentId}:${t}`;

type OrderRecord = NonNullable<Awaited<ReturnType<OrdersService['get']>>>;

const IST_MS = 330 * 60_000;
/** Start of the IST day containing `now`. */
export const istDayStart = (now: Date) =>
  new Date(Math.floor((now.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);

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
      pickedUpAt: null,
      deliveredAt: null,
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
    const online = new Map((await this.repo.riders({ online: true })).map((r) => [r.userId, r]));
    const candidates: Candidate[] = [];
    for (const pos of await this.locations.near(c.store, radius, now)) {
      const r = online.get(pos.riderId);
      if (!r || tried.has(r.userId)) continue;
      if (!standby && r.zones.length && !r.zones.includes(f.microMarketId)) continue;
      if ((await this.repo.openOffersForRider(r.userId)).length) continue;
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
    if (!proof.photoMediaId && proof.otp !== f.deliveryOtp)
      throw new DomainError(
        'WRONG_CODE',
        'That OTP is not right. Ask the customer for the 4-digit code in their app.',
      );
    const c = await this.ctx(f);
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
