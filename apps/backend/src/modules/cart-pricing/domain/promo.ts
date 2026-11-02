/**
 * Promo rules (PRD FR-PRC-3): flat or percent off items, with a cap, a minimum order, validity
 * window, scope (micro-markets, supply types, stores), per-user limit, first-order-only, a total
 * budget and a merchant-funded share. Pure: the caller supplies usage counts.
 */
import type { MerchantType, PromoKind } from '@prisma/client';

export interface PromoRecord {
  id: string;
  code: string;
  description: string;
  descriptionTe: string;
  kind: PromoKind;
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  budgetPaise: number | null;
  spentPaise: number;
  perUserLimit: number;
  firstOrderOnly: boolean;
  merchantSharePercent: number;
  microMarketIds: string[];
  merchantTypes: MerchantType[];
  merchantIds: string[];
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PromoRejection =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'not_applicable'
  | 'min_order'
  | 'first_order_only'
  | 'limit_reached'
  | 'budget_exhausted';

export interface PromoContext {
  itemsPaise: number;
  merchant: { id: string; type: MerchantType; microMarketId: string };
  /** Redemptions by this user that are reserved or confirmed. */
  userRedemptions: number;
  /** Orders this user has placed before (any store), excluding failed payments. */
  userPlacedOrders: number;
  now: Date;
}

export type PromoResult =
  | { ok: true; discountPaise: number; merchantSharePaise: number }
  | { ok: false; reason: PromoRejection; minOrderPaise?: number };

/** Codes are case-insensitive and stored upper-case. */
export const normaliseCode = (code: string) => code.trim().toUpperCase();

export function rawDiscount(p: Pick<PromoRecord, 'kind' | 'value' | 'maxDiscountPaise'>, itemsPaise: number): number {
  const d = p.kind === 'flat' ? p.value : Math.floor((itemsPaise * p.value) / 100);
  return Math.max(0, Math.min(d, p.maxDiscountPaise ?? Number.MAX_SAFE_INTEGER, itemsPaise));
}

export function evaluatePromo(p: PromoRecord, ctx: PromoContext): PromoResult {
  if (!p.active) return { ok: false, reason: 'inactive' };
  if (ctx.now < p.validFrom) return { ok: false, reason: 'not_started' };
  if (p.validTo && ctx.now >= p.validTo) return { ok: false, reason: 'expired' };
  if (p.microMarketIds.length && !p.microMarketIds.includes(ctx.merchant.microMarketId)) return { ok: false, reason: 'not_applicable' };
  if (p.merchantTypes.length && !p.merchantTypes.includes(ctx.merchant.type)) return { ok: false, reason: 'not_applicable' };
  if (p.merchantIds.length && !p.merchantIds.includes(ctx.merchant.id)) return { ok: false, reason: 'not_applicable' };
  if (p.firstOrderOnly && ctx.userPlacedOrders > 0) return { ok: false, reason: 'first_order_only' };
  if (ctx.userRedemptions >= p.perUserLimit) return { ok: false, reason: 'limit_reached' };
  if (ctx.itemsPaise < p.minOrderPaise) return { ok: false, reason: 'min_order', minOrderPaise: p.minOrderPaise };
  const discountPaise = rawDiscount(p, ctx.itemsPaise);
  if (discountPaise <= 0) return { ok: false, reason: 'not_applicable' };
  // Budget exhaustion disables the code: no partial discounts past the budget.
  if (p.budgetPaise != null && p.spentPaise + discountPaise > p.budgetPaise) return { ok: false, reason: 'budget_exhausted' };
  return { ok: true, discountPaise, merchantSharePaise: Math.round((discountPaise * p.merchantSharePercent) / 100) };
}
