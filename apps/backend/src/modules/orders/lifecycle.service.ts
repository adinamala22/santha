import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { haversineMeters } from '../../common/geo/polygon';
import { istParts } from '../../common/hours';
import type { DomainEvent } from '../../infra/outbox/domain-event';
import { EventBus } from '../../infra/outbox/event-bus';
import { Timers } from '../../infra/timers/timers';
import { DiscoverySchema, SlaSchema } from '../analytics-config/domain/micro-market-config';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { CatalogueService } from '../merchant-catalogue/catalogue.service';
import type { MerchantRecord } from '../merchant-catalogue/domain/merchant';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments-settlement/payments.service';
import { isTerminal } from './domain/state-machine';
import { type OrderRecord, OrderRepository, type OrderState } from './orders.repository';
import { beyondRadius } from './domain/beyond-radius';
import { OrdersService } from './orders.service';

export const ACCEPT_TIMEOUT = 'order.accept_timeout';
export const REMIND_SMS = 'order.remind_merchant_sms';
export const REMIND_CALL = 'order.remind_merchant_call';
/** Unanswered new order: SMS the owner after 30 s, call them after 60 s (then it expires at the hard window). */
export const REMIND_SMS_SEC = 30;
export const REMIND_CALL_SEC = 60;
export const REJECT_REASONS = ['out_of_stock', 'store_closing', 'too_busy', 'cannot_deliver', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export const CANCEL_REASONS = ['changed_mind', 'ordered_by_mistake', 'taking_too_long', 'other'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** Merchant app tabs (mockup: New · Preparing · Ready · Out · Done). */
export const BUCKETS = {
  new: ['PLACED'],
  preparing: ['ACCEPTED', 'PREPARING'],
  ready: ['READY'],
  out: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'FAILED_DELIVERY'],
  done: ['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'],
} as const satisfies Record<string, readonly OrderState[]>;
export type Bucket = keyof typeof BUCKETS;

export type ItemAction = { action: 'remove' } | { action: 'substitute'; itemId: string; variantId: string };

export interface MerchantOrderView {
  order: OrderRecord;
  /** Exact address only after acceptance (privacy invariant); before that, the area and distance. */
  addressVisible: boolean;
  distanceM: number;
  acceptBy: Date | null;
  expiresAt: Date | null;
}

export interface MerchantDaySummary {
  orders: number;
  itemsPaise: number;
  acceptanceRate: number | null;
  avgPrepMin: number | null;
}

const key = (orderId: string, timer = 'accept') => `order:${orderId}:${timer}`;

/**
 * orders (M5) — the merchant side of the lifecycle: accept (with fulfilment choice) → preparing →
 * ready, reject, item unavailable (remove or substitute, refunding the difference to the wallet at
 * once), the accept window (timer → EXPIRED, refunded), and customer cancellation before acceptance.
 * Every move goes through OrdersService.move (the single guarded transition).
 */
@Injectable()
export class OrderLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(OrderLifecycleService.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly orders: OrdersService,
    private readonly merchants: MerchantsService,
    private readonly catalogue: CatalogueService,
    private readonly payments: PaymentsService,
    private readonly markets: MicroMarketsService,
    private readonly notifications: NotificationsService,
    private readonly timers: Timers,
    private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timers.register(ACCEPT_TIMEOUT, (d) => this.onAcceptTimeout(d.orderId as string));
    this.timers.register(REMIND_SMS, (d) => this.remind(d.orderId as string, 'sms'));
    this.timers.register(REMIND_CALL, (d) => this.remind(d.orderId as string, 'voice'));
    this.bus.on('order.placed', 'order-timers', (e) => this.onPlaced(e));
  }

  // ───────────── timers ─────────────

  private async sla(order: Pick<OrderRecord, 'microMarketId'>) {
    const v = await this.markets.effective(order.microMarketId, this.clock());
    return { sla: SlaSchema.parse(v?.sla ?? { merchantAcceptSec: 20, etaBufferMin: 8, riderFallbackMin: 5, staleCatalogueHours: 72 }), discovery: DiscoverySchema.parse(v?.discovery ?? {}) };
  }

  private async onPlaced(e: DomainEvent): Promise<void> {
    const o = await this.repo.get(e.aggregate.id);
    if (!o || o.state !== 'PLACED') return;
    const { sla } = await this.sla(o);
    const at = (o.placedAt ?? this.clock()).getTime();
    await this.timers.schedule(key(o.id), ACCEPT_TIMEOUT, new Date(at + sla.merchantAcceptHardSec * 1000), { orderId: o.id });
    if (REMIND_SMS_SEC < sla.merchantAcceptHardSec) await this.timers.schedule(key(o.id, 'sms'), REMIND_SMS, new Date(at + REMIND_SMS_SEC * 1000), { orderId: o.id });
    if (REMIND_CALL_SEC < sla.merchantAcceptHardSec) await this.timers.schedule(key(o.id, 'call'), REMIND_CALL, new Date(at + REMIND_CALL_SEC * 1000), { orderId: o.id });
  }

  private async remind(orderId: string, channel: 'sms' | 'voice'): Promise<void> {
    const o = await this.repo.get(orderId);
    if (o?.state === 'PLACED') await this.notifications.remindMerchant(o.merchantId, o.id, o.code, channel);
  }

  /** Accept window timers end with the first answer (or cancellation). */
  private async cancelTimers(orderId: string): Promise<void> {
    await Promise.all([this.timers.cancel(key(orderId)), this.timers.cancel(key(orderId, 'sms')), this.timers.cancel(key(orderId, 'call'))]);
  }

  /** Nobody answered in the hard window: EXPIRED, money back, counts towards auto-pause. */
  async onAcceptTimeout(orderId: string): Promise<void> {
    const o = await this.repo.get(orderId);
    if (!o || o.state !== 'PLACED') return;
    if (await this.orders.move(o, 'EXPIRED', 'system', null, 'merchant_no_response', { outcomeReason: 'merchant_no_response' })) {
      await this.cancelTimers(o.id);
      await this.refundRemaining(o, 'Store did not accept in time');
    }
  }

  // ───────────── merchant actions ─────────────

  async accept(ownerUserId: string, orderId: string, opts: { fulfilmentMode?: 'self' | 'rider' | undefined; staffId?: string | undefined }): Promise<MerchantOrderView> {
    const { merchant, order } = await this.ownedOrder(ownerUserId, orderId);
    if (order.state !== 'PLACED') throw new DomainError('INVALID_STATE', 'This order is no longer waiting for you.', { state: order.state });
    const { discovery } = await this.sla(order);
    const now = this.clock();
    // Fashion always goes with a Santha rider (try-on and returns). A "Deliver anywhere" store delivers its
    // orders from beyond its radius itself (ADR-022). Otherwise the merchant chooses.
    const ownTrip = merchant.deliversAnywhere && beyondRadius(order);
    if (ownTrip && opts.fulfilmentMode === 'rider')
      throw new DomainError('VALIDATION_FAILED', 'Deliver anywhere is on: you deliver orders from beyond your radius yourself.', { field: 'fulfilmentMode' });
    const mode = merchant.type === 'fashion' ? 'rider' : ownTrip ? 'self' : (opts.fulfilmentMode ?? merchant.defaultFulfilment);
    let staffId: string | null = null;
    if (mode === 'self' && opts.staffId) {
      const staff = (await this.merchants.staffOf(merchant.id)).find((s) => s.id === opts.staffId && s.active);
      if (!staff) throw new DomainError('VALIDATION_FAILED', 'Choose one of your staff members.', { field: 'staffId' });
      staffId = staff.id;
    }
    const prepMin = discovery.defaultPrepMin[merchant.type];
    const packBy = order.slotStartsAt ? new Date(order.slotStartsAt.getTime() - 10 * 60_000) : new Date(now.getTime() + prepMin * 60_000);
    // dispatch-tracking starts the delivery from this event (staff link, or the rider search).
    if (!(await this.orders.move(order, 'ACCEPTED', 'merchant', ownerUserId, 'accepted', { acceptedAt: now, fulfilmentMode: mode, packBy }, { fulfilment_mode: mode, staff_id: staffId, pack_by: packBy.toISOString() })))
      throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    await this.cancelTimers(order.id);
    const accepted = (await this.repo.get(order.id))!;
    await this.orders.move(accepted, 'PREPARING', 'merchant', ownerUserId, 'started_packing');
    return this.merchantView(merchant, (await this.repo.get(order.id))!);
  }

  async reject(ownerUserId: string, orderId: string, reason: RejectReason): Promise<MerchantOrderView> {
    const { merchant, order } = await this.ownedOrder(ownerUserId, orderId);
    if (order.state !== 'PLACED') throw new DomainError('INVALID_STATE', 'Only new orders can be rejected.', { state: order.state });
    if (!(await this.orders.move(order, 'REJECTED', 'merchant', ownerUserId, reason, { outcomeReason: reason }))) throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    await this.cancelTimers(order.id);
    await this.refundRemaining(order, 'Store could not take the order');
    return this.merchantView(merchant, (await this.repo.get(order.id))!);
  }

  async markReady(ownerUserId: string, orderId: string): Promise<MerchantOrderView> {
    const { merchant, order } = await this.ownedOrder(ownerUserId, orderId);
    if (order.state !== 'PREPARING') throw new DomainError('INVALID_STATE', 'Only orders being prepared can be marked ready.', { state: order.state });
    await this.orders.move(order, 'READY', 'merchant', ownerUserId, 'packed', { readyAt: this.clock() });
    return this.merchantView(merchant, (await this.repo.get(order.id))!);
  }

  /**
   * An item is not available while packing: remove it, or substitute another item from the store at
   * the same or lower price. The difference goes back to the customer's wallet at once (online
   * orders); for COD the amount due drops. If nothing is left, the order is cancelled and refunded.
   */
  async itemUnavailable(ownerUserId: string, orderId: string, variantId: string, act: ItemAction): Promise<MerchantOrderView> {
    const { merchant, order } = await this.ownedOrder(ownerUserId, orderId);
    if (order.state !== 'ACCEPTED' && order.state !== 'PREPARING') throw new DomainError('INVALID_STATE', 'Items can only be changed while preparing.', { state: order.state });
    const line = order.lines.find((l) => l.variantId === variantId);
    if (!line || (line.status ?? 'ok') !== 'ok') throw new DomainError('NOT_FOUND', 'Item not found in this order');

    let patch: Record<string, unknown>;
    let refund: number;
    let event: string;
    if (act.action === 'remove') {
      refund = line.linePaise;
      patch = { status: 'removed', refundPaise: refund };
      event = 'order.item_removed';
    } else {
      const sub = await this.catalogue.itemView(act.itemId);
      const v = sub?.item.variants.find((x) => x.id === act.variantId);
      if (!sub || sub.item.merchantId !== merchant.id || sub.item.status !== 'active' || !v || v.stock === 'out')
        throw new DomainError('VALIDATION_FAILED', 'Choose an item from your store that is in stock.');
      if (v.pricePaise > line.unitPricePaise) throw new DomainError('VALIDATION_FAILED', 'A substitute cannot cost more than the item the customer paid for.');
      refund = (line.unitPricePaise - v.pricePaise) * line.quantity;
      patch = { status: 'substituted', substituteItemId: sub.item.id, substituteVariantId: v.id, substituteName: sub.item.name, substituteVariantLabel: v.label, substituteUnitPaise: v.pricePaise, refundPaise: refund };
      event = 'order.item_substituted';
    }

    await this.repo.transaction(async (tx) => {
      const locked = await tx.lock(order.id);
      if (!locked || (locked.state !== 'ACCEPTED' && locked.state !== 'PREPARING')) throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
      if ((locked.lines.find((l) => l.variantId === variantId)?.status ?? 'ok') !== 'ok') throw new DomainError('INVALID_STATE', 'This item was already changed.');
      await tx.updateLine(order.id, variantId, patch as never);
      if (refund > 0) await tx.addRefund(order.id, refund);
      await tx.appendEvent({
        type: event,
        aggregate: { type: 'order', id: order.id },
        microMarketId: order.microMarketId,
        actor: { type: 'user', id: ownerUserId },
        payload: { user_id: order.userId, merchant_id: order.merchantId, code: order.code, variant_id: variantId, name: line.name, substitute_name: (patch as { substituteName?: string }).substituteName ?? null, refund_paise: refund },
      });
    });
    if (refund > 0) await this.creditIfPaid(order, refund, act.action === 'remove' ? `${line.name} was not available` : `${line.name} replaced with a cheaper item`);

    const after = (await this.repo.get(order.id))!;
    if (after.lines.every((l) => l.status === 'removed')) {
      if (await this.orders.move(after, 'CANCELLED', 'merchant', ownerUserId, 'all_items_unavailable', { outcomeReason: 'all_items_unavailable' }))
        await this.refundRemaining((await this.repo.get(order.id))!, 'Nothing in the order was available');
    }
    return this.merchantView(merchant, (await this.repo.get(order.id))!);
  }

  // ───────────── customer ─────────────

  /** Free cancellation until the store accepts; after that it is the store's call (and cooked food never). */
  async customerCancel(userId: string, orderId: string, reason: CancelReason): Promise<void> {
    const o = await this.repo.get(orderId);
    if (!o || o.userId !== userId) throw new DomainError('NOT_FOUND', 'Order not found');
    if (o.state === 'AWAITING_PAYMENT') {
      await this.orders.abandonPayment(userId, orderId);
      return;
    }
    if (o.state !== 'PLACED') throw new DomainError('INVALID_STATE', 'The store has already started on this order. Contact support to cancel.', { state: o.state });
    if (!(await this.orders.move(o, 'CANCELLED', 'customer', userId, reason, { outcomeReason: reason }))) throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    await this.cancelTimers(o.id);
    await this.refundRemaining(o, 'You cancelled the order');
  }

  // ───────────── merchant reads ─────────────

  async list(ownerUserId: string, bucket: Bucket): Promise<{ items: MerchantOrderView[]; counts: Record<Bucket, number>; summary: MerchantDaySummary }> {
    const merchant = await this.merchants.ownedBy(ownerUserId);
    const today = this.startOfIstDay();
    const recent = await this.repo.listForMerchant(merchant.id, { since: new Date(today.getTime() - 2 * 86_400_000), limit: 500 });
    // Active buckets show everything still open; "done" only today's.
    const visible = recent.filter((o) => o.state !== 'AWAITING_PAYMENT' && o.state !== 'PAYMENT_FAILED' && (!isTerminal(o.state) || o.createdAt >= today));
    const inBucket = (b: Bucket, o: OrderRecord) => (BUCKETS[b] as readonly OrderState[]).includes(o.state);
    const counts = Object.fromEntries((Object.keys(BUCKETS) as Bucket[]).map((b) => [b, visible.filter((o) => inBucket(b, o)).length])) as Record<Bucket, number>;
    const items = visible.filter((o) => inBucket(bucket, o)).sort((a, b) => (bucket === 'done' ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime()));
    return { items: await Promise.all(items.map((o) => this.merchantView(merchant, o))), counts, summary: this.summary(recent.filter((o) => o.createdAt >= today)) };
  }

  async get(ownerUserId: string, orderId: string): Promise<MerchantOrderView> {
    const { merchant, order } = await this.ownedOrder(ownerUserId, orderId);
    return this.merchantView(merchant, order);
  }

  private summary(today: OrderRecord[]): MerchantDaySummary {
    const real = today.filter((o) => o.state !== 'AWAITING_PAYMENT' && o.state !== 'PAYMENT_FAILED');
    const answered = real.filter((o) => o.acceptedAt || o.state === 'REJECTED' || o.state === 'EXPIRED');
    const accepted = real.filter((o) => o.acceptedAt);
    const prepped = accepted.filter((o) => o.readyAt);
    return {
      orders: accepted.length,
      itemsPaise: accepted.reduce((s, o) => s + o.itemsPaise - o.refundedPaise, 0),
      acceptanceRate: answered.length ? accepted.length / answered.length : null,
      avgPrepMin: prepped.length ? Math.round(prepped.reduce((s, o) => s + (o.readyAt!.getTime() - o.acceptedAt!.getTime()), 0) / prepped.length / 60_000) : null,
    };
  }

  private async merchantView(merchant: MerchantRecord, order: OrderRecord): Promise<MerchantOrderView> {
    const { sla } = await this.sla(order);
    const placed = order.placedAt?.getTime() ?? order.createdAt.getTime();
    return {
      order,
      addressVisible: !!order.acceptedAt,
      distanceM: merchant.location ? Math.round(haversineMeters(merchant.location, order.address.location)) : 0,
      acceptBy: order.state === 'PLACED' ? new Date(placed + sla.merchantAcceptSec * 1000) : null,
      expiresAt: order.state === 'PLACED' ? new Date(placed + sla.merchantAcceptHardSec * 1000) : null,
    };
  }

  // ───────────── helpers ─────────────

  private async ownedOrder(ownerUserId: string, orderId: string): Promise<{ merchant: MerchantRecord; order: OrderRecord }> {
    const merchant = await this.merchants.ownedBy(ownerUserId);
    const order = await this.repo.get(orderId);
    if (!order || order.merchantId !== merchant.id || order.state === 'AWAITING_PAYMENT' || order.state === 'PAYMENT_FAILED') throw new DomainError('NOT_FOUND', 'Order not found');
    return { merchant, order };
  }

  /** Gives back whatever has not been refunded yet (wallet, instantly — refunds to source arrive in M7). */
  /**
   * No courier after the whole fallback ladder and the customer chose to cancel: full refund (M6).
   * dispatch-tracking checks the fallback stage before calling this.
   */
  async cancelForNoCourier(userId: string, orderId: string): Promise<void> {
    const o = await this.repo.get(orderId);
    if (!o || o.userId !== userId) throw new DomainError('NOT_FOUND', 'Order not found');
    if (!['ACCEPTED', 'PREPARING', 'READY'].includes(o.state)) throw new DomainError('INVALID_STATE', 'This order can no longer be cancelled here.', { state: o.state });
    if (!(await this.orders.move(o, 'CANCELLED', 'system', userId, 'no_courier', { outcomeReason: 'no_courier' }))) throw new DomainError('INVALID_STATE', 'This order changed. Refresh and try again.');
    await this.refundRemaining(o, 'No delivery partner was available');
  }

  private async refundRemaining(order: OrderRecord, note: string): Promise<void> {
    const fresh = (await this.repo.get(order.id))!;
    const remaining = fresh.totalPaise - fresh.refundedPaise;
    if (remaining <= 0) return;
    await this.repo.transaction((tx) => tx.addRefund(order.id, remaining));
    await this.creditIfPaid(fresh, remaining, note);
  }

  /** Online orders whose payment was captured get wallet credit; COD orders just owe less. */
  private async creditIfPaid(order: OrderRecord, amountPaise: number, note: string): Promise<void> {
    if (order.paymentMethod !== 'online') return;
    const intent = await this.payments.intentForOrder(order.id);
    if (intent?.status !== 'captured') return;
    await this.payments.creditWallet({ userId: order.userId, amountPaise, orderId: order.id, note: `${note} (order ${order.code})`, microMarketId: order.microMarketId });
  }

  private startOfIstDay(): Date {
    return new Date(`${istParts(this.clock()).date}T00:00:00+05:30`);
  }
}

