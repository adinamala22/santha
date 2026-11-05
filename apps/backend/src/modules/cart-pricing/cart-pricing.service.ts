import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { haversineMeters, type LatLng } from '../../common/geo/polygon';
import type { DomainEvent } from '../../infra/outbox/domain-event';
import { EventBus } from '../../infra/outbox/event-bus';
import { FeeRulesSchema } from '../analytics-config/domain/micro-market-config';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { CatalogueService, type ItemView } from '../merchant-catalogue/catalogue.service';
import type { MerchantRecord } from '../merchant-catalogue/domain/merchant';
import { type CartLineRecord, type CartRecord, CartPricingRepository, type NewPromo, type PromoPatch, type QuoteRecord } from './cart-pricing.repository';
import { computeQuote, type FeeCard, type PricedLineInput, type PromoApplied, type Quote } from './domain/pricing';
import { evaluatePromo, normaliseCode, type PromoRecord, type PromoRejection } from './domain/promo';

export const MAX_CART_LINES = 50;
export const MAX_LINE_QTY = 50;

export interface CartLineMeta {
  itemId: string;
  categorySlug: string;
  foodMark: string | null;
  imageUrl: string | null;
  availableDays: string[];
  dailyCapacity: number | null;
  madeToOrder: boolean;
}

export interface CartView {
  cart: CartRecord | null;
  merchant: MerchantRecord | null;
  /** Lines priced from the live catalogue (no delivery address yet, so no fees). */
  lines: Array<PricedLineInput & { linePaise: number; meta: CartLineMeta }>;
  itemsPaise: number;
  itemCount: number;
}

export interface PromoOutcome {
  code: string;
  applied: boolean;
  reason: PromoRejection | null;
  description: string | null;
  descriptionTe: string | null;
  discountPaise: number;
  /** For `min_order`: what the cart must reach. */
  minOrderPaise: number | null;
  promoId: string | null;
  merchantSharePaise: number;
}

export interface PricedCart {
  cart: CartRecord;
  merchant: MerchantRecord;
  microMarketId: string;
  fees: FeeCard;
  quote: Quote;
  promo: PromoOutcome | null;
  meta: CartLineMeta[];
}

export interface ReservedPromo {
  promoId: string;
  code: string;
  discountPaise: number;
  merchantSharePaise: number;
}

const ORDER_RELEASE_EVENTS = ['order.payment_failed', 'order.cancelled', 'order.rejected', 'order.expired'] as const;

/**
 * cart-pricing — the cart (one store at a time), the bill (computeQuote over the live catalogue
 * and the micro-market fee card), quote snapshots, and promos with budgets.
 * Events in: order.placed (confirm promo, clear cart), order.payment_failed / cancelled / rejected /
 * expired (release promo budget). Ops: /ops/promos with audit.
 */
@Injectable()
export class CartPricingService implements OnModuleInit {
  private readonly logger = new Logger(CartPricingService.name);

  constructor(
    private readonly repo: CartPricingRepository,
    private readonly catalogue: CatalogueService,
    private readonly markets: MicroMarketsService,
    private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.bus.on('order.placed', 'cart-pricing', (e) => this.onPlaced(e));
    for (const type of ORDER_RELEASE_EVENTS) this.bus.on(type, 'cart-pricing', (e) => this.onReleased(e));
  }

  // ───────────── cart ─────────────

  async getCart(userId: string): Promise<CartView> {
    const cart = await this.repo.getCart(userId);
    if (!cart) return { cart: null, merchant: null, lines: [], itemsPaise: 0, itemCount: 0 };
    const snap = await this.catalogue.indexSnapshot(cart.merchantId);
    if (!snap) return { cart, merchant: null, lines: [], itemsPaise: 0, itemCount: 0 };
    const { lines, meta } = this.priceLines(cart.lines, snap.items);
    const priced = lines.map((l, i) => ({ ...l, linePaise: l.available && l.stock !== 'out' ? l.unitPricePaise * l.quantity : 0, meta: meta[i]! }));
    return {
      cart,
      merchant: snap.merchant,
      lines: priced,
      itemsPaise: priced.reduce((s, l) => s + l.linePaise, 0),
      itemCount: priced.reduce((s, l) => s + (l.linePaise ? l.quantity : 0), 0),
    };
  }

  /**
   * Replaces the cart (the app sends its whole local cart). A cart holds one store: putting another
   * store's items fails with CART_CONFLICT unless `replace` is set (the "start a new cart?" prompt).
   */
  async putCart(userId: string, input: { merchantId: string; lines: CartLineRecord[]; replace?: boolean | undefined }): Promise<CartView> {
    if (!input.lines.length) {
      await this.repo.deleteCart(userId);
      return this.getCart(userId);
    }
    if (input.lines.length > MAX_CART_LINES) throw new DomainError('VALIDATION_FAILED', `A cart can hold up to ${MAX_CART_LINES} different items.`);
    const existing = await this.repo.getCart(userId);
    if (existing && existing.merchantId !== input.merchantId && !input.replace) {
      const other = await this.catalogue.indexSnapshot(existing.merchantId);
      throw new DomainError('CART_CONFLICT', 'Your cart has items from another store.', { merchantId: existing.merchantId, merchantName: other?.merchant.name ?? null });
    }
    const snap = await this.catalogue.indexSnapshot(input.merchantId);
    if (!snap || snap.merchant.status !== 'live') throw new DomainError('NOT_FOUND', 'This store is not on Santha right now.');
    const variants = new Map(snap.items.flatMap((v) => v.item.variants.map((x) => [x.id, v.item.id] as const)));
    const merged = new Map<string, CartLineRecord>();
    for (const l of input.lines) {
      if (variants.get(l.variantId) !== l.itemId) throw new DomainError('VALIDATION_FAILED', 'One of the items is not sold by this store.', { itemId: l.itemId, variantId: l.variantId });
      const prev = merged.get(l.variantId);
      merged.set(l.variantId, { ...l, quantity: Math.min(MAX_LINE_QTY, (prev?.quantity ?? 0) + l.quantity) });
    }
    await this.repo.putCart({ userId, merchantId: input.merchantId, lines: [...merged.values()] });
    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<void> {
    await this.repo.deleteCart(userId);
  }

  // ───────────── pricing ─────────────

  /** Prices the user's cart for delivery to `location` with the effective fee card and the promo (if any). */
  async priceCart(userId: string, input: { location: LatLng; promoCode?: string | null | undefined; placedOrders: number }): Promise<PricedCart> {
    const cart = await this.repo.getCart(userId);
    if (!cart || !cart.lines.length) throw new DomainError('CART_EMPTY', 'Your cart is empty.');
    const snap = await this.catalogue.indexSnapshot(cart.merchantId);
    if (!snap || snap.merchant.status !== 'live' || !snap.merchant.microMarketId || !snap.merchant.location)
      throw new DomainError('NOT_FOUND', 'This store is not on Santha right now.');
    const merchant = snap.merchant;
    const version = await this.markets.effective(merchant.microMarketId!, this.clock());
    if (!version) throw new DomainError('NOT_SERVICEABLE', 'This store is not taking orders right now.');
    // Parse so versions stored before a key existed get its default (e.g. the GST rates added in M4).
    const fees: FeeCard = FeeRulesSchema.parse(version.fees);
    const { lines, meta } = this.priceLines(cart.lines, snap.items);
    const itemsPaise = lines.filter((l) => l.available && l.stock !== 'out').reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);

    const promo = input.promoCode ? await this.evaluateCode(input.promoCode, { userId, merchant, itemsPaise, placedOrders: input.placedOrders }) : null;
    const applied: PromoApplied | null = promo?.applied ? { code: promo.code, discountPaise: promo.discountPaise, merchantSharePaise: promo.merchantSharePaise } : null;
    const distanceM = haversineMeters(merchant.location!, input.location);
    const quote = computeQuote({
      merchant: { id: merchant.id, type: merchant.type, movPaise: merchant.movPaise, packagingFeePaise: merchant.packagingFeePaise },
      lines,
      distanceM,
      fees,
      promo: applied,
      beyondRadius: distanceM > merchant.radiusM, // ADR-022: farther than the store's radius costs more
    });
    if (promo?.applied) promo.discountPaise = quote.discountPaise;
    return { cart, merchant, microMarketId: merchant.microMarketId!, fees, quote, promo, meta };
  }

  async saveQuote<S>(q: Omit<QuoteRecord<S>, 'createdAt'>): Promise<QuoteRecord<S>> {
    return this.repo.saveQuote(q);
  }

  getQuote<S>(id: string): Promise<QuoteRecord<S> | null> {
    return this.repo.getQuote<S>(id);
  }

  private priceLines(cartLines: CartLineRecord[], items: ItemView[]): { lines: PricedLineInput[]; meta: CartLineMeta[] } {
    const byItem = new Map(items.map((v) => [v.item.id, v]));
    const lines: PricedLineInput[] = [];
    const meta: CartLineMeta[] = [];
    for (const l of cartLines) {
      const v = byItem.get(l.itemId);
      const variant = v?.item.variants.find((x) => x.id === l.variantId);
      lines.push({
        itemId: l.itemId,
        variantId: l.variantId,
        name: v?.item.name ?? 'Item no longer available',
        nameTe: v?.item.nameTe ?? null,
        variantLabel: variant?.label ?? '',
        quantity: l.quantity,
        unitPricePaise: variant?.pricePaise ?? 0,
        mrpPaise: variant?.mrpPaise ?? null,
        stock: variant?.stock ?? 'out',
        stale: v?.stale ?? false,
        maxPerOrder: v?.item.maxPerOrder ?? null,
        substitution: l.substitution,
        available: !!v && !!variant && v.item.status === 'active' && !v.item.deletedAt,
      });
      meta.push({
        itemId: l.itemId,
        categorySlug: v?.item.categorySlug ?? '',
        foodMark: v?.item.foodMark ?? null,
        imageUrl: v?.imageUrl ?? null,
        availableDays: v?.item.availableDays ?? [],
        dailyCapacity: v?.item.dailyCapacity ?? null,
        madeToOrder: v?.item.madeToOrder ?? false,
      });
    }
    return { lines, meta };
  }

  // ───────────── promos ─────────────

  private async evaluateCode(
    raw: string,
    ctx: { userId: string; merchant: MerchantRecord; itemsPaise: number; placedOrders: number },
  ): Promise<PromoOutcome> {
    const code = normaliseCode(raw);
    const p = await this.repo.getPromoByCode(code);
    const base = { code, description: p?.description ?? null, descriptionTe: p?.descriptionTe ?? null, promoId: p?.id ?? null };
    if (!p) return { ...base, applied: false, reason: 'not_found', discountPaise: 0, minOrderPaise: null, merchantSharePaise: 0 };
    const r = evaluatePromo(p, {
      itemsPaise: ctx.itemsPaise,
      merchant: { id: ctx.merchant.id, type: ctx.merchant.type, microMarketId: ctx.merchant.microMarketId! },
      userRedemptions: await this.repo.activeRedemptions(p.id, ctx.userId),
      userPlacedOrders: ctx.placedOrders,
      now: this.clock(),
    });
    return r.ok
      ? { ...base, applied: true, reason: null, discountPaise: r.discountPaise, minOrderPaise: null, merchantSharePaise: r.merchantSharePaise }
      : { ...base, applied: false, reason: r.reason, discountPaise: 0, minOrderPaise: r.minOrderPaise ?? null, merchantSharePaise: 0 };
  }

  /**
   * Reserves the promo's budget for an order (compare-and-swap). Fails with PROMO_INVALID when the
   * budget ran out since the quote — that is how an exhausted budget disables a code at once.
   */
  async reservePromo(input: { promoId: string; code: string; userId: string; orderId: string; discountPaise: number; merchantSharePaise: number }): Promise<ReservedPromo> {
    await this.repo.transaction(async (tx) => {
      if (!(await tx.reserveBudget(input.promoId, input.discountPaise)))
        throw new DomainError('PROMO_INVALID', `The code ${input.code} has run out. Place the order without it?`, { code: input.code, reason: 'budget_exhausted' });
      await tx.insertRedemption({
        promoId: input.promoId,
        userId: input.userId,
        orderId: input.orderId,
        discountPaise: input.discountPaise,
        merchantSharePaise: input.merchantSharePaise,
        status: 'reserved',
      });
    });
    return { promoId: input.promoId, code: input.code, discountPaise: input.discountPaise, merchantSharePaise: input.merchantSharePaise };
  }

  /** Gives back a reservation (order never got placed, or was cancelled before delivery). Idempotent. */
  async releasePromo(orderId: string): Promise<void> {
    await this.repo.transaction(async (tx) => {
      const r = await tx.redemptionForOrder(orderId);
      if (!r || r.status === 'released') return;
      if (await tx.setRedemptionStatus(orderId, r.status, 'released')) await tx.releaseBudget(r.promoId, r.discountPaise);
    });
  }

  private async onPlaced(e: DomainEvent): Promise<void> {
    const orderId = e.aggregate.id;
    const userId = (e.payload as { user_id?: string }).user_id;
    await this.repo.transaction((tx) => tx.setRedemptionStatus(orderId, 'reserved', 'confirmed'));
    if (userId) {
      const cart = await this.repo.getCart(userId);
      if (cart && cart.merchantId === (e.payload as { merchant_id?: string }).merchant_id) await this.repo.deleteCart(userId);
    }
  }

  private async onReleased(e: DomainEvent): Promise<void> {
    await this.releasePromo(e.aggregate.id);
  }

  // ───────────── ops ─────────────

  listPromos(): Promise<PromoRecord[]> {
    return this.repo.listPromos();
  }

  async createPromo(input: Omit<NewPromo, 'createdBy' | 'active'> & { active?: boolean | undefined }, actor: { userId: string; requestId?: string | null }): Promise<PromoRecord> {
    validatePromo(input);
    const code = normaliseCode(input.code);
    try {
      return await this.repo.transaction(async (tx) => {
        const p = await tx.createPromo({ ...input, code, active: input.active ?? true, createdBy: actor.userId });
        await tx.appendAudit({ entity: 'promo', entityId: p.id, action: 'promo.created', actorId: actor.userId, requestId: actor.requestId ?? null, after: promoAudit(p) });
        return p;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new DomainError('ALREADY_EXISTS', `A promo with code ${code} already exists.`);
      throw err;
    }
  }

  async updatePromo(id: string, patch: PromoPatch, actor: { userId: string; requestId?: string | null }): Promise<PromoRecord> {
    return this.repo.transaction(async (tx) => {
      const before = await tx.getPromo(id);
      if (!before) throw new DomainError('NOT_FOUND', 'Promo not found');
      validatePromo({ ...before, ...patch });
      if (patch.budgetPaise != null && patch.budgetPaise < before.spentPaise)
        throw new DomainError('VALIDATION_FAILED', `The budget can't be lower than what is already used (₹${(before.spentPaise / 100).toFixed(2)}).`);
      const after = await tx.updatePromo(id, patch);
      const action = patch.active === false && before.active ? 'promo.paused' : patch.active === true && !before.active ? 'promo.resumed' : 'promo.updated';
      await tx.appendAudit({ entity: 'promo', entityId: id, action, actorId: actor.userId, requestId: actor.requestId ?? null, before: promoAudit(before), after: promoAudit(after) });
      return after;
    });
  }
}

function validatePromo(p: Pick<PromoRecord, 'kind' | 'value' | 'merchantSharePercent' | 'validFrom' | 'validTo' | 'maxDiscountPaise'>): void {
  if (p.kind === 'percent' && (p.value < 1 || p.value > 100)) throw new DomainError('VALIDATION_FAILED', 'A percent discount must be between 1 and 100.');
  if (p.kind === 'percent' && p.maxDiscountPaise == null) throw new DomainError('VALIDATION_FAILED', 'Percent promos need a maximum discount.');
  if (p.kind === 'flat' && p.value < 100) throw new DomainError('VALIDATION_FAILED', 'A flat discount must be at least ₹1.');
  if (p.merchantSharePercent < 0 || p.merchantSharePercent > 100) throw new DomainError('VALIDATION_FAILED', 'Merchant share must be 0–100%.');
  if (p.validTo && p.validTo <= p.validFrom) throw new DomainError('VALIDATION_FAILED', 'The end date must be after the start date.');
}

const promoAudit = (p: PromoRecord) => ({
  code: p.code,
  kind: p.kind,
  value: p.value,
  maxDiscountPaise: p.maxDiscountPaise,
  minOrderPaise: p.minOrderPaise,
  budgetPaise: p.budgetPaise,
  perUserLimit: p.perUserLimit,
  firstOrderOnly: p.firstOrderOnly,
  merchantSharePercent: p.merchantSharePercent,
  validFrom: p.validFrom.toISOString(),
  validTo: p.validTo?.toISOString() ?? null,
  active: p.active,
});
