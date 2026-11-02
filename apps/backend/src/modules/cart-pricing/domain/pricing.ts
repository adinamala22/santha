/**
 * computeQuote — the bill for one single-store cart (santha-backend "Key algorithms", PRD 8).
 * Pure: everything it needs is passed in (cart lines priced from the catalogue, the micro-market
 * fee card, the evaluated promo). Money is integer paise; every total is recomputed from lines and
 * fee rows, never carried over.
 *
 * Tax model (ADR-010): item prices are GST-inclusive (MRP rules), so items carry no extra tax line.
 * The platform's own fees (delivery, platform, small-order) carry GST at `gstOnFeesPercent`.
 * Cooked food from home kitchens is taxed at `gstCookedFoodPercent` on food + packaging, collected
 * by the platform as e-commerce operator (CGST s.9(5)).
 */
import type { MerchantType } from '@prisma/client';

export type Substitution = 'call_me' | 'similar' | 'remove';
export const SUBSTITUTIONS: readonly Substitution[] = ['call_me', 'similar', 'remove'];

export interface FeeCard {
  deliveryBasePaise: number;
  deliveryPerKmPaise: number;
  freeDeliveryAbovePaise: number;
  smallOrderThresholdPaise: number;
  smallOrderFeePaise: number;
  platformFeePaise: number;
  packagingFeeCapPaise: number;
  gstOnFeesPercent: number;
  gstCookedFoodPercent: number;
}

export interface PricedLineInput {
  itemId: string;
  variantId: string;
  name: string;
  nameTe: string | null;
  variantLabel: string;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number | null;
  stock: 'in' | 'low' | 'out';
  stale: boolean;
  maxPerOrder: number | null;
  substitution: Substitution;
  /** False when the item was deleted/hidden or the size no longer exists. */
  available: boolean;
}

export interface PromoApplied {
  code: string;
  discountPaise: number;
  merchantSharePaise: number;
}

export interface QuoteInput {
  merchant: { id: string; type: MerchantType; movPaise: number; packagingFeePaise: number };
  lines: PricedLineInput[];
  /** Straight-line distance store → delivery address. */
  distanceM: number;
  fees: FeeCard;
  promo: PromoApplied | null;
}

export type FeeCode = 'delivery' | 'small_order' | 'platform' | 'packaging';
export type TaxCode = 'gst_fees' | 'gst_food';

export interface QuoteLine extends PricedLineInput {
  linePaise: number;
  /** MRP − price, × quantity (what the customer saves vs MRP). */
  savingsPaise: number;
}

export interface FeeRow {
  code: FeeCode;
  amountPaise: number;
  /** Fee before a waiver (e.g. free delivery above the threshold); 0 when not waived. */
  waivedPaise: number;
}

export interface TaxRow {
  code: TaxCode;
  ratePercent: number;
  basePaise: number;
  amountPaise: number;
}

export type ProblemCode =
  | 'EMPTY_CART'
  | 'ITEM_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'MAX_PER_ORDER'
  | 'MIN_ORDER_NOT_MET';

export interface QuoteProblem {
  code: ProblemCode;
  itemId?: string;
  variantId?: string;
  /** For MAX_PER_ORDER the limit; for MIN_ORDER_NOT_MET the shortfall in paise. */
  value?: number;
}

export interface Quote {
  lines: QuoteLine[];
  itemCount: number;
  itemsPaise: number;
  mrpSavingsPaise: number;
  fees: FeeRow[];
  feesPaise: number;
  taxes: TaxRow[];
  taxPaise: number;
  discount: PromoApplied | null;
  discountPaise: number;
  totalPaise: number;
  /** Items needed to reach free delivery (0 = already free). */
  toFreeDeliveryPaise: number;
  distanceM: number;
  problems: QuoteProblem[];
  placeable: boolean;
}

const pct = (base: number, percent: number) => Math.round((base * percent) / 100);

/** Delivery fee: base + per-km on the straight-line distance (rounded to the paisa), free above the threshold. */
export function deliveryFee(itemsPaise: number, distanceM: number, f: FeeCard): FeeRow {
  const full = f.deliveryBasePaise + Math.round((f.deliveryPerKmPaise * distanceM) / 1000);
  const waived = f.freeDeliveryAbovePaise > 0 && itemsPaise >= f.freeDeliveryAbovePaise;
  return { code: 'delivery', amountPaise: waived ? 0 : full, waivedPaise: waived ? full : 0 };
}

export function computeQuote(input: QuoteInput): Quote {
  const { fees: f, merchant } = input;
  const problems: QuoteProblem[] = [];

  const lines: QuoteLine[] = input.lines.map((l) => ({
    ...l,
    linePaise: l.unitPricePaise * l.quantity,
    savingsPaise: l.mrpPaise != null && l.mrpPaise > l.unitPricePaise ? (l.mrpPaise - l.unitPricePaise) * l.quantity : 0,
  }));

  if (!lines.length) problems.push({ code: 'EMPTY_CART' });
  const perItem = new Map<string, number>();
  for (const l of lines) perItem.set(l.itemId, (perItem.get(l.itemId) ?? 0) + l.quantity);
  for (const l of lines) {
    if (!l.available) problems.push({ code: 'ITEM_UNAVAILABLE', itemId: l.itemId, variantId: l.variantId });
    else if (l.stock === 'out') problems.push({ code: 'OUT_OF_STOCK', itemId: l.itemId, variantId: l.variantId });
  }
  for (const [itemId, qty] of perItem) {
    const max = lines.find((l) => l.itemId === itemId)?.maxPerOrder;
    if (max != null && qty > max) problems.push({ code: 'MAX_PER_ORDER', itemId, value: max });
  }

  // Only lines that can actually be supplied count towards the bill.
  const billable = lines.filter((l) => l.available && l.stock !== 'out');
  const itemsPaise = billable.reduce((s, l) => s + l.linePaise, 0);
  const itemCount = billable.reduce((s, l) => s + l.quantity, 0);
  const mrpSavingsPaise = billable.reduce((s, l) => s + l.savingsPaise, 0);

  if (lines.length && itemsPaise < merchant.movPaise)
    problems.push({ code: 'MIN_ORDER_NOT_MET', value: merchant.movPaise - itemsPaise });

  const fees: FeeRow[] = [];
  if (itemCount > 0) {
    fees.push(deliveryFee(itemsPaise, input.distanceM, f));
    if (itemsPaise < f.smallOrderThresholdPaise) fees.push({ code: 'small_order', amountPaise: f.smallOrderFeePaise, waivedPaise: 0 });
    if (f.platformFeePaise > 0) fees.push({ code: 'platform', amountPaise: f.platformFeePaise, waivedPaise: 0 });
    const packaging = Math.min(merchant.packagingFeePaise, f.packagingFeeCapPaise);
    if (packaging > 0) fees.push({ code: 'packaging', amountPaise: packaging, waivedPaise: 0 });
  }
  const feesPaise = fees.reduce((s, r) => s + r.amountPaise, 0);

  // A discount never exceeds the items it applies to.
  const discount = input.promo && itemsPaise > 0 ? { ...input.promo, discountPaise: Math.min(input.promo.discountPaise, itemsPaise) } : null;
  if (discount) discount.merchantSharePaise = Math.min(discount.merchantSharePaise, discount.discountPaise);
  const discountPaise = discount?.discountPaise ?? 0;

  const taxes: TaxRow[] = [];
  const platformFees = fees.filter((r) => r.code !== 'packaging').reduce((s, r) => s + r.amountPaise, 0);
  if (platformFees > 0 && f.gstOnFeesPercent > 0)
    taxes.push({ code: 'gst_fees', ratePercent: f.gstOnFeesPercent, basePaise: platformFees, amountPaise: pct(platformFees, f.gstOnFeesPercent) });
  if (merchant.type === 'home_kitchen' && itemCount > 0 && f.gstCookedFoodPercent > 0) {
    const packaging = fees.find((r) => r.code === 'packaging')?.amountPaise ?? 0;
    const base = itemsPaise - discountPaise + packaging;
    taxes.push({ code: 'gst_food', ratePercent: f.gstCookedFoodPercent, basePaise: base, amountPaise: pct(base, f.gstCookedFoodPercent) });
  }
  const taxPaise = taxes.reduce((s, t) => s + t.amountPaise, 0);

  const totalPaise = itemsPaise + feesPaise + taxPaise - discountPaise;
  const toFreeDeliveryPaise = f.freeDeliveryAbovePaise > 0 ? Math.max(0, f.freeDeliveryAbovePaise - itemsPaise) : 0;

  return {
    lines,
    itemCount,
    itemsPaise,
    mrpSavingsPaise,
    fees,
    feesPaise,
    taxes,
    taxPaise,
    discount,
    discountPaise,
    totalPaise,
    toFreeDeliveryPaise,
    distanceM: Math.round(input.distanceM),
    problems,
    placeable: problems.length === 0,
  };
}
