import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { haversineMeters } from '../../common/geo/polygon';
import { istParts, openStatus } from '../../common/hours';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { DomainEvent } from '../../infra/outbox/domain-event';
import { EventBus } from '../../infra/outbox/event-bus';
import { CodRulesSchema } from '../analytics-config/domain/micro-market-config';
import { FlagsService } from '../analytics-config/flags.service';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { CartPricingService, type PricedCart, type PromoOutcome } from '../cart-pricing/cart-pricing.service';
import type { Quote } from '../cart-pricing/domain/pricing';
import { AddressesService } from '../identity-kyc/addresses.service';
import { CatalogueService } from '../merchant-catalogue/catalogue.service';
import type { MerchantRecord } from '../merchant-catalogue/domain/merchant';
import { type CheckoutPayload, PaymentsService } from '../payments-settlement/payments.service';
import { assertTransition, EVENT_FOR, type OrderActor } from './domain/state-machine';
import { type NewOrder, type OrderAddress, type OrderRecord, OrderRepository, type OrderState, type TransitionRecord, type TransitionSet } from './orders.repository';

export type When = { mode: 'asap' } | { mode: 'slot'; slotId: string; date: string };

export interface CheckoutInput {
  addressId: string;
  when: When;
  promoCode?: string | null | undefined;
}

export type CheckoutProblemCode =
  | 'NOT_DELIVERABLE'
  | 'STORE_CLOSED'
  | 'SLOT_REQUIRED'
  | 'SLOT_NOT_ALLOWED'
  | 'SLOT_UNAVAILABLE'
  | 'NOT_ON_MENU'
  | 'DAILY_CAPACITY';

export interface CheckoutProblem {
  code: CheckoutProblemCode | Quote['problems'][number]['code'];
  itemId?: string | undefined;
  variantId?: string | undefined;
  value?: number | undefined;
  at?: string | undefined;
}

export type CodReason = 'cooked_food' | 'type_not_allowed' | 'over_limit' | 'disabled' | 'too_many_open';

export interface Checkout {
  quoteId: string;
  expiresAt: Date;
  merchant: Pick<MerchantRecord, 'id' | 'name' | 'nameTe' | 'type'>;
  address: OrderAddress;
  when: When & { startsAt?: Date; end?: string };
  bill: Quote;
  promo: PromoOutcome | null;
  problems: CheckoutProblem[];
  placeable: boolean;
  payment: { online: boolean; cod: { available: boolean; reason: CodReason | null; maxOrderPaise: number } };
}

/** What a quote snapshot stores: the inputs (to re-price at placement) and the result. */
interface QuoteSnapshot {
  input: CheckoutInput;
  checkout: Omit<Checkout, 'quoteId' | 'expiresAt'>;
}

export interface OrderView {
  order: OrderRecord<QuoteSnapshot['checkout']>;
  merchant: { id: string; name: string; nameTe: string | null; type: string };
  history: TransitionRecord[];
  payment: CheckoutPayload | null;
}

/** Each user may have this many unpaid-for (live) COD orders at once — the MVP "COD trust" rule. */
export const MAX_OPEN_COD = 2;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * orders (M4 part) — checkout (re-priced quote + delivery, timing, capacity and COD checks),
 * placing orders (POST /orders, Idempotency-Key), and the pre-lifecycle payment states.
 * An order becomes PLACED only when the payment is captured or COD is authorised. Every state
 * change goes through `transition()` (state-machine.ts) inside an OrderRepository transaction.
 * Events in: payment.captured. Events out: order.created, order.placed, order.payment_failed.
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly pricing: CartPricingService,
    private readonly payments: PaymentsService,
    private readonly catalogue: CatalogueService,
    private readonly addresses: AddressesService,
    private readonly markets: MicroMarketsService,
    private readonly flags: FlagsService,
    private readonly idempotency: IdempotencyService,
    private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.bus.on('payment.captured', 'orders', (e) => this.onPaymentCaptured(e));
    this.catalogue.registerSlotBookings((merchantId, dates) => this.repo.slotBookings(merchantId, dates));
  }

  // ───────────── checkout ─────────────

  /** Prices the cart for an address and time, checks everything placing would check, saves the quote. */
  async checkout(userId: string, input: CheckoutInput): Promise<Checkout> {
    const addressView = (await this.addresses.list(userId)).find((a) => a.address.id === input.addressId);
    if (!addressView) throw new DomainError('NOT_FOUND', 'Address not found');
    const a = addressView.address;
    const placedOrders = await this.repo.countPlaced(userId);
    const priced = await this.pricing.priceCart(userId, { location: a.location, promoCode: input.promoCode, placedOrders });
    const m = priced.merchant;
    const now = this.clock();
    const problems: CheckoutProblem[] = [...priced.quote.problems];

    // Delivery: the address must be in the store's micro-market and within its radius.
    const hit = await this.markets.resolve(a.location, now);
    if (hit?.market.id !== m.microMarketId || haversineMeters(m.location!, a.location) > m.radiusM) problems.push({ code: 'NOT_DELIVERABLE' });

    // A paused store (toggle or auto-pause after missed orders) takes no orders.
    if (!m.acceptingOrders) problems.push({ code: 'STORE_CLOSED' });

    // Timing: home kitchens sell by slot (cut-off, capacity, menu days, portions); others ASAP while open.
    const when: Checkout['when'] = { ...input.when };
    if (m.type === 'home_kitchen') {
      if (input.when.mode !== 'slot') problems.push({ code: 'SLOT_REQUIRED' });
      else problems.push(...(await this.slotProblems(m, input.when, priced, when)));
    } else if (input.when.mode === 'slot') problems.push({ code: 'SLOT_NOT_ALLOWED' });
    else {
      const s = openStatus(m.hours, now);
      if (!s.open) problems.push({ code: 'STORE_CLOSED', at: s.nextOpenAt?.toISOString() });
    }

    const cod = await this.codDecision(userId, m, priced.quote.totalPaise);
    const expiresAt = new Date(now.getTime() + this.env.QUOTE_TTL_MIN * 60_000);
    const checkout: Omit<Checkout, 'quoteId' | 'expiresAt'> = {
      merchant: { id: m.id, name: m.name, nameTe: m.nameTe, type: m.type },
      address: { addressId: a.id, label: a.label, name: a.name, line: a.line, landmark: a.landmark, pincode: a.pincode, location: a.location },
      when,
      bill: priced.quote,
      promo: priced.promo,
      problems,
      placeable: problems.length === 0,
      payment: { online: true, cod },
    };
    const q = await this.pricing.saveQuote<QuoteSnapshot>({
      id: randomUUID(),
      userId,
      merchantId: m.id,
      microMarketId: priced.microMarketId,
      totalPaise: priced.quote.totalPaise,
      snapshot: { input, checkout },
      expiresAt,
    });
    return { ...checkout, quoteId: q.id, expiresAt };
  }

  private async slotProblems(m: MerchantRecord, w: Extract<When, { mode: 'slot' }>, priced: PricedCart, out: Checkout['when']): Promise<CheckoutProblem[]> {
    const problems: CheckoutProblem[] = [];
    const { occurrences } = await this.catalogue.slotAvailability(m.id, 2);
    const occ = occurrences.find((o) => o.slotId === w.slotId && o.date === w.date);
    if (!occ || occ.state !== 'open') return [{ code: 'SLOT_UNAVAILABLE', at: occ?.cutoffAt.toISOString() }];
    Object.assign(out, { startsAt: occ.startsAt, end: occ.end });
    const day = istParts(occ.startsAt).day;
    const portions = await this.repo.itemPortions(m.id, w.date);
    const wanted = new Map<string, number>();
    for (const l of priced.quote.lines) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + l.quantity);
    for (const meta of priced.meta) {
      if (meta.availableDays.length && !meta.availableDays.includes(day)) problems.push({ code: 'NOT_ON_MENU', itemId: meta.itemId });
      else if (meta.dailyCapacity != null) {
        const left = meta.dailyCapacity - (portions.get(meta.itemId) ?? 0);
        if ((wanted.get(meta.itemId) ?? 0) > left) problems.push({ code: 'DAILY_CAPACITY', itemId: meta.itemId, value: Math.max(0, left) });
      }
    }
    return dedupe(problems);
  }

  /**
   * COD (PRD 8.6): COD-enabled micro-market (config + flag), retail/fashion only (never cooked
   * food), order total ≤ the market's cap, and fewer than MAX_OPEN_COD live COD orders (trust).
   */
  private async codDecision(userId: string, m: MerchantRecord, totalPaise: number): Promise<Checkout['payment']['cod']> {
    const version = await this.markets.effective(m.microMarketId!, this.clock());
    const rules = CodRulesSchema.parse(version?.cod ?? { enabled: false, maxOrderPaise: 0, allowedTypes: [] });
    const decide = async (): Promise<CodReason | null> => {
      if (m.type === 'home_kitchen') return 'cooked_food';
      if (!rules.enabled || !(await this.flags.isEnabled('cod_payments', { distinctId: userId, microMarketId: m.microMarketId }))) return 'disabled';
      if (!(rules.allowedTypes as string[]).includes(m.type)) return 'type_not_allowed';
      if (totalPaise > rules.maxOrderPaise) return 'over_limit';
      if ((await this.repo.countOpenCod(userId)) >= MAX_OPEN_COD) return 'too_many_open';
      return null;
    };
    const reason = await decide();
    return { available: reason === null, reason, maxOrderPaise: rules.maxOrderPaise };
  }

  // ───────────── placing ─────────────

  /**
   * POST /orders. Re-prices the accepted quote; if anything changed the customer must confirm the
   * new bill (QUOTE_CHANGED). COD orders are PLACED at once; online orders wait for payment
   * (AWAITING_PAYMENT) and carry the checkout payload for the payment sheet.
   */
  async place(userId: string, idempotencyKey: string | undefined, body: { quoteId: string; paymentMethod: 'online' | 'cod'; instructions?: string | null | undefined }): Promise<{ view: OrderView; replayed: boolean }> {
    const { value, replayed } = await this.idempotency.run('orders', userId, idempotencyKey, body, async () => {
      // Durable backstop if the idempotency cache was lost: the key is unique per user in the DB.
      const existing = await this.repo.getByIdempotencyKey(userId, idempotencyKey!);
      if (existing) return existing.id;
      return this.placeNew(userId, idempotencyKey!, body);
    });
    return { view: await this.view(userId, value), replayed };
  }

  private async placeNew(userId: string, key: string, body: { quoteId: string; paymentMethod: 'online' | 'cod'; instructions?: string | null | undefined }): Promise<string> {
    const q = await this.pricing.getQuote<QuoteSnapshot>(body.quoteId);
    if (!q || q.userId !== userId) throw new DomainError('NOT_FOUND', 'Quote not found');
    if (q.expiresAt <= this.clock()) throw new DomainError('QUOTE_EXPIRED', 'Prices may have changed. Please review your bill again.');

    const fresh = await this.checkout(userId, q.snapshot.input);
    if (!fresh.placeable) throw new DomainError('NOT_PLACEABLE', 'Some things in your order need attention.', { quoteId: fresh.quoteId, problems: fresh.problems });
    if (fresh.bill.totalPaise !== q.totalPaise)
      throw new DomainError('QUOTE_CHANGED', 'Your bill changed. Please check the new total.', { quoteId: fresh.quoteId, totalPaise: fresh.bill.totalPaise, previousTotalPaise: q.totalPaise });
    if (body.paymentMethod === 'cod' && !fresh.payment.cod.available)
      throw new DomainError('COD_NOT_ALLOWED', 'Cash on delivery is not available for this order.', { reason: fresh.payment.cod.reason });

    const orderId = randomUUID();
    const promo = fresh.promo?.applied && fresh.bill.discount ? fresh.promo : null;
    if (promo)
      await this.pricing.reservePromo({
        promoId: promo.promoId!,
        code: promo.code,
        userId,
        orderId,
        discountPaise: fresh.bill.discount!.discountPaise,
        merchantSharePaise: fresh.bill.discount!.merchantSharePaise,
      });

    const now = this.clock();
    const cod = body.paymentMethod === 'cod';
    const when = fresh.when;
    let order: OrderRecord;
    try {
      order = await this.insertWithCode({
        id: orderId,
        userId,
        merchantId: fresh.merchant.id,
        microMarketId: q.microMarketId,
        state: cod ? 'PLACED' : 'AWAITING_PAYMENT',
        paymentMethod: body.paymentMethod,
        fulfilmentWhen: when.mode,
        slotId: when.mode === 'slot' ? when.slotId : null,
        slotDate: when.mode === 'slot' ? when.date : null,
        slotStartsAt: when.mode === 'slot' ? (when.startsAt ?? null) : null,
        address: fresh.address,
        instructions: body.instructions?.trim() || null,
        itemsPaise: fresh.bill.itemsPaise,
        feesPaise: fresh.bill.feesPaise,
        taxPaise: fresh.bill.taxPaise,
        discountPaise: fresh.bill.discountPaise,
        totalPaise: fresh.bill.totalPaise,
        promoCode: promo?.code ?? null,
        quote: { ...fresh, quoteId: undefined, expiresAt: undefined },
        idempotencyKey: key,
        placedAt: cod ? now : null,
        paymentDueAt: cod ? null : new Date(now.getTime() + this.env.PAYMENT_WINDOW_MIN * 60_000),
        lines: fresh.bill.lines
          .filter((l) => l.available && l.stock !== 'out')
          .map((l) => ({
            itemId: l.itemId,
            variantId: l.variantId,
            name: l.name,
            variantLabel: l.variantLabel,
            quantity: l.quantity,
            unitPricePaise: l.unitPricePaise,
            mrpPaise: l.mrpPaise,
            linePaise: l.linePaise,
            substitution: l.substitution,
          })),
      });
    } catch (err) {
      if (promo) await this.pricing.releasePromo(orderId);
      throw err;
    }

    if (!cod) {
      try {
        await this.payments.createIntent(order);
      } catch (err) {
        await this.move(order, 'PAYMENT_FAILED', 'system', null, 'payment_setup_failed');
        throw err;
      }
    }
    return order.id;
  }

  /** Inserts with a fresh short code (retries on the rare collision); emits order.placed / order.created. */
  private async insertWithCode(o: Omit<NewOrder, 'code'>): Promise<OrderRecord> {
    for (let attempt = 0; ; attempt++) {
      const code = 'SN' + Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      try {
        return await this.repo.transaction(async (tx) => {
          const order = await tx.insert({ ...o, code }, { type: 'customer', id: o.userId });
          await tx.appendEvent({
            type: EVENT_FOR[o.state],
            aggregate: { type: 'order', id: o.id },
            microMarketId: o.microMarketId,
            actor: { type: 'user', id: o.userId },
            payload: orderPayload(order),
          });
          return order;
        });
      } catch (err) {
        const codeClash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 3 && !(await this.repo.getByIdempotencyKey(o.userId, o.idempotencyKey));
        if (!codeClash) throw err;
      }
    }
  }

  // ───────────── state changes ─────────────

  /** The single guarded transition: validates the edge, CAS on the state, history row + event in one transaction. */
  async move(order: OrderRecord, to: OrderState, actor: OrderActor, actorId: string | null, reason: string, set: TransitionSet = {}): Promise<boolean> {
    const cookedFood = (order.quote as QuoteSnapshot['checkout'] | null)?.merchant?.type === 'home_kitchen';
    try {
      assertTransition(order.state, to, actor, { cookedFood });
    } catch (err) {
      // Illegal transitions are refused and logged (M5 acceptance).
      this.logger.warn({ orderId: order.id, from: order.state, to, actor, actorId, reason }, 'Illegal order transition refused');
      throw err;
    }
    return this.repo.transaction(async (tx) => {
      const moved = await tx.transition(order.id, { from: order.state, to, actor: { type: actor, id: actorId }, reason, set });
      if (!moved) return false; // someone else moved it first
      await tx.appendEvent({
        type: EVENT_FOR[to],
        aggregate: { type: 'order', id: order.id },
        microMarketId: order.microMarketId,
        actor: { type: actor === 'customer' ? 'user' : actor === 'ops' ? 'ops' : 'system', id: actorId },
        payload: { ...orderPayload(order), from: order.state, to, reason },
      });
      return true;
    });
  }

  private async onPaymentCaptured(e: DomainEvent): Promise<void> {
    const p = e.payload as { order_id: string; amount_paise: number; user_id: string };
    const order = await this.repo.get(p.order_id);
    if (!order) return;
    if (order.state === 'AWAITING_PAYMENT') {
      if (await this.move(order, 'PLACED', 'system', null, 'payment_captured', { placedAt: this.clock() })) return;
    }
    const latest = await this.repo.get(p.order_id);
    if (latest?.state === 'PAYMENT_FAILED') {
      // Money arrived after the order lapsed: give it back as wallet credit (refunds to source arrive in M7).
      await this.payments.creditWallet({
        userId: latest.userId,
        amountPaise: p.amount_paise,
        orderId: latest.id,
        note: `Payment for order ${latest.code} arrived after it was cancelled`,
        microMarketId: latest.microMarketId,
      });
    }
  }

  /** The customer closed the payment sheet / gave up: the order will not be placed. */
  async abandonPayment(userId: string, orderId: string): Promise<OrderView> {
    const o = await this.owned(userId, orderId);
    if (o.state !== 'AWAITING_PAYMENT') throw new DomainError('INVALID_STATE', 'This order is not waiting for payment.');
    await this.move(o, 'PAYMENT_FAILED', 'customer', userId, 'customer_abandoned');
    return this.view(userId, orderId);
  }

  /** Online orders not paid within PAYMENT_WINDOW_MIN become PAYMENT_FAILED (promo budget released). */
  async expireUnpaid(): Promise<{ expired: number }> {
    let expired = 0;
    for (const o of await this.repo.awaitingPaymentDue(this.clock(), 200)) {
      const intent = await this.payments.intentForOrder(o.id);
      if (intent?.status === 'captured') continue; // capture is being processed
      if (await this.move(o, 'PAYMENT_FAILED', 'system', null, 'payment_timeout')) expired++;
    }
    return { expired };
  }

  // ───────────── reads ─────────────

  async list(userId: string): Promise<OrderView[]> {
    const orders = (await this.repo.listForUser(userId, 50)).filter((o) => o.state !== 'PAYMENT_FAILED' || o.updatedAt.getTime() > this.clock().getTime() - 86_400_000);
    return Promise.all(orders.map((o) => this.toView(o, false)));
  }

  async view(userId: string, orderId: string): Promise<OrderView> {
    return this.toView(await this.owned(userId, orderId), true);
  }

  private async toView(o: OrderRecord, withHistory: boolean): Promise<OrderView> {
    const q = o.quote as QuoteSnapshot['checkout'];
    const intent = o.paymentMethod === 'online' ? await this.payments.intentForOrder(o.id) : null;
    return {
      order: o as OrderRecord<QuoteSnapshot['checkout']>,
      merchant: { id: o.merchantId, name: q.merchant.name, nameTe: q.merchant.nameTe, type: q.merchant.type },
      history: withHistory ? await this.repo.history(o.id) : [],
      payment: intent ? this.payments.checkout(intent) : null,
    };
  }

  private async owned(userId: string, orderId: string): Promise<OrderRecord> {
    const o = await this.repo.get(orderId);
    if (!o || o.userId !== userId) throw new DomainError('NOT_FOUND', 'Order not found');
    return o;
  }
}

function orderPayload(o: OrderRecord) {
  return {
    user_id: o.userId,
    merchant_id: o.merchantId,
    code: o.code,
    payment_method: o.paymentMethod,
    total_paise: o.totalPaise,
    discount_paise: o.discountPaise,
    promo_code: o.promoCode,
    fulfilment_when: o.fulfilmentWhen,
    slot_id: o.slotId,
    slot_date: o.slotDate,
    item_count: o.lines.reduce((s, l) => s + l.quantity, 0),
  };
}

function dedupe(ps: CheckoutProblem[]): CheckoutProblem[] {
  const seen = new Set<string>();
  return ps.filter((p) => {
    const k = `${p.code}:${p.itemId ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
