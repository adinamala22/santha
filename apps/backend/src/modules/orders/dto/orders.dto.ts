import { createZodDto } from '../../../common/zod-dto';
import { z } from 'zod';
import { SUBSTITUTIONS } from '../../cart-pricing/domain/pricing';
import type { CheckoutPayload } from '../../payments-settlement/payments.service';
import type { Checkout, OrderView } from '../orders.service';

const iso = z.iso.datetime();
const int = z.number().int();
const latLng = z.object({ lat: z.number(), lng: z.number() });

const WhenSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('asap') }),
  z.object({ mode: z.literal('slot'), slotId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);

export class CheckoutInputDto extends createZodDto(
  z.object({
    addressId: z.uuid(),
    when: WhenSchema.describe('asap, or a home-kitchen slot occurrence (slotId + IST date)'),
    promoCode: z.string().trim().max(20).nullable().optional(),
  }),
) {}

export class PlaceOrderDto extends createZodDto(
  z.object({
    quoteId: z.uuid().describe('From POST /cart/price; the order is placed at exactly this bill'),
    paymentMethod: z.enum(['online', 'cod']),
    instructions: z.string().trim().max(300).nullable().optional().describe('Delivery instructions, e.g. "Ring the bell twice"'),
    tipPaise: z.number().int().min(0).max(50_000).optional().describe('Tip for the delivery partner (ADR-032): added to the total, 100% to whoever delivers'),
  }),
) {}

export class ConfirmPaymentDto extends createZodDto(
  z.object({
    providerOrderId: z.string().min(1).max(64).describe('razorpay_order_id'),
    providerPaymentId: z.string().min(1).max(64).describe('razorpay_payment_id'),
    signature: z.string().min(1).max(256).describe('razorpay_signature'),
  }),
) {}

const BillLineSchema = z.object({
  itemId: z.uuid(),
  variantId: z.uuid(),
  name: z.string(),
  nameTe: z.string().nullable(),
  variantLabel: z.string(),
  quantity: int,
  unitPricePaise: int,
  mrpPaise: int.nullable(),
  linePaise: int,
  savingsPaise: int,
  stock: z.enum(['in', 'low', 'out']),
  stale: z.boolean(),
  available: z.boolean(),
  substitution: z.enum(SUBSTITUTIONS as [string, ...string[]]),
});

export const BillSchema = z.object({
  lines: z.array(BillLineSchema),
  itemCount: int,
  itemsPaise: int,
  mrpSavingsPaise: int,
  fees: z.array(z.object({ code: z.enum(['delivery', 'beyond_radius', 'small_order', 'platform', 'packaging']), amountPaise: int, waivedPaise: int })),
  feesPaise: int,
  taxes: z.array(z.object({ code: z.enum(['gst_fees', 'gst_food']), ratePercent: int, basePaise: int, amountPaise: int })),
  taxPaise: int,
  discount: z.object({ code: z.string(), discountPaise: int, merchantSharePaise: int }).nullable(),
  discountPaise: int,
  totalPaise: int,
  toFreeDeliveryPaise: int,
  distanceM: int,
});

const ProblemSchema = z.object({
  code: z.string().describe('EMPTY_CART | ITEM_UNAVAILABLE | OUT_OF_STOCK | MAX_PER_ORDER | MIN_ORDER_NOT_MET | NOT_DELIVERABLE | STORE_CLOSED | SLOT_REQUIRED | SLOT_NOT_ALLOWED | SLOT_UNAVAILABLE | NOT_ON_MENU | DAILY_CAPACITY'),
  itemId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  value: int.optional(),
  at: iso.optional(),
});

const AddressSchema = z.object({
  addressId: z.uuid().nullable(),
  label: z.string(),
  name: z.string().nullable(),
  line: z.string(),
  landmark: z.string().nullable(),
  pincode: z.string().nullable(),
  location: latLng,
});

const WhenOutSchema = z.object({
  mode: z.enum(['asap', 'slot']),
  slotId: z.uuid().optional(),
  date: z.string().optional(),
  startsAt: iso.optional(),
  end: z.string().optional(),
});

const PromoOutcomeSchema = z.object({
  code: z.string(),
  applied: z.boolean(),
  reason: z.string().nullable().describe('not_found | inactive | not_started | expired | not_applicable | min_order | first_order_only | limit_reached | budget_exhausted'),
  description: z.string().nullable(),
  descriptionTe: z.string().nullable(),
  discountPaise: int,
  minOrderPaise: int.nullable(),
});

export class CheckoutDto extends createZodDto(
  z.object({
    quoteId: z.uuid(),
    expiresAt: iso,
    merchant: z.object({ id: z.uuid(), name: z.string(), nameTe: z.string().nullable(), type: z.string() }),
    address: AddressSchema,
    when: WhenOutSchema,
    bill: BillSchema,
    promo: PromoOutcomeSchema.nullable(),
    problems: z.array(ProblemSchema),
    placeable: z.boolean(),
    payment: z.object({
      online: z.boolean(),
      cod: z.object({ available: z.boolean(), reason: z.string().nullable().describe('cooked_food | type_not_allowed | over_limit | disabled | too_many_open'), maxOrderPaise: int }),
    }),
  }),
) {}

export const PaymentSchema = z.object({
  intentId: z.uuid(),
  provider: z.enum(['razorpay', 'mock']),
  providerOrderId: z.string(),
  keyId: z.string().nullable().describe('Razorpay key id for the checkout SDK (null for the mock)'),
  amountPaise: int,
  currency: z.string(),
  status: z.enum(['created', 'captured', 'failed']),
  lastFailure: z.string().nullable(),
});
export class PaymentDto extends createZodDto(PaymentSchema) {}

const OrderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  state: z.enum(['AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED_DELIVERY']),
  merchant: z.object({ id: z.uuid(), name: z.string(), nameTe: z.string().nullable(), type: z.string() }),
  paymentMethod: z.enum(['online', 'cod']),
  when: WhenOutSchema,
  address: AddressSchema,
  instructions: z.string().nullable(),
  lines: z.array(
    z.object({ itemId: z.uuid(), variantId: z.uuid(), name: z.string(), variantLabel: z.string(), quantity: int, unitPricePaise: int, mrpPaise: int.nullable(), linePaise: int, substitution: z.string(),
      status: z.enum(['ok', 'removed', 'substituted']), substituteName: z.string().nullable(), substituteVariantLabel: z.string().nullable(), refundPaise: int }),
  ),
  bill: BillSchema,
  itemsPaise: int,
  feesPaise: int,
  taxPaise: int,
  discountPaise: int,
  totalPaise: int,
  tipPaise: int.describe('Tip for the delivery partner, included in totalPaise (ADR-032)'),
  /** Refunded so far (cancellations, removed or cheaper substitute items), M5. */
  refundedPaise: int,
  /** Why it ended: a reject / cancel reason, or "accept_timeout". */
  outcomeReason: z.string().nullable(),
  /** The customer may cancel only before the store accepts (PLACED). */
  canCancel: z.boolean(),
  promoCode: z.string().nullable(),
  placedAt: iso.nullable(),
  paymentDueAt: iso.nullable(),
  createdAt: iso,
  history: z.array(z.object({ from: z.string().nullable(), to: z.string(), actorType: z.string(), reason: z.string().nullable(), at: iso })),
  payment: PaymentSchema.nullable(),
});
export class OrderDto extends createZodDto(OrderSchema) {}
export class OrderListDto extends createZodDto(z.object({ items: z.array(OrderSchema) })) {}

export class WalletDto extends createZodDto(
  z.object({
    balancePaise: int,
    entries: z.array(z.object({ id: z.uuid(), amountPaise: int, kind: z.string(), orderId: z.uuid().nullable(), note: z.string().nullable(), createdAt: iso })),
  }),
) {}

// ───────────── mappers ─────────────

const whenOut = (w: Checkout['when']) => ({
  mode: w.mode,
  ...(w.mode === 'slot' ? { slotId: w.slotId, date: w.date } : {}),
  ...(w.startsAt ? { startsAt: new Date(w.startsAt).toISOString() } : {}),
  ...(w.end ? { end: w.end } : {}),
});

const billOut = (b: Checkout['bill']) => ({
  ...b,
  lines: b.lines.map((l) => ({
    itemId: l.itemId,
    variantId: l.variantId,
    name: l.name,
    nameTe: l.nameTe,
    variantLabel: l.variantLabel,
    quantity: l.quantity,
    unitPricePaise: l.unitPricePaise,
    mrpPaise: l.mrpPaise,
    linePaise: l.linePaise,
    savingsPaise: l.savingsPaise,
    stock: l.stock,
    stale: l.stale,
    available: l.available,
    substitution: l.substitution,
  })),
});

const promoOut = (p: Checkout['promo']) =>
  p && { code: p.code, applied: p.applied, reason: p.reason, description: p.description, descriptionTe: p.descriptionTe, discountPaise: p.discountPaise, minOrderPaise: p.minOrderPaise };

export const toCheckoutDto = (c: Checkout) => ({
  quoteId: c.quoteId,
  expiresAt: c.expiresAt.toISOString(),
  merchant: c.merchant,
  address: c.address,
  when: whenOut(c.when),
  bill: billOut(c.bill),
  promo: promoOut(c.promo),
  problems: c.problems.map((p) => ({ code: p.code, ...(p.itemId ? { itemId: p.itemId } : {}), ...(p.variantId ? { variantId: p.variantId } : {}), ...(p.value != null ? { value: p.value } : {}), ...(p.at ? { at: p.at } : {}) })),
  placeable: c.placeable,
  payment: c.payment,
});

export const toPaymentDto = (p: CheckoutPayload) => p;

export const toOrderDto = (v: OrderView) => {
  const o = v.order;
  const q = o.quote;
  return {
    id: o.id,
    code: o.code,
    state: o.state,
    merchant: v.merchant,
    paymentMethod: o.paymentMethod,
    when: whenOut(q.when),
    address: o.address,
    instructions: o.instructions,
    lines: o.lines.map((l) => ({
      itemId: l.itemId,
      variantId: l.variantId,
      name: l.name,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      mrpPaise: l.mrpPaise,
      linePaise: l.linePaise,
      substitution: l.substitution,
      status: l.status ?? 'ok',
      substituteName: l.substituteName ?? null,
      substituteVariantLabel: l.substituteVariantLabel ?? null,
      refundPaise: l.refundPaise ?? 0,
    })),
    bill: billOut(q.bill),
    itemsPaise: o.itemsPaise,
    feesPaise: o.feesPaise,
    taxPaise: o.taxPaise,
    discountPaise: o.discountPaise,
    totalPaise: o.totalPaise,
    tipPaise: o.tipPaise ?? 0,
    refundedPaise: o.refundedPaise ?? 0,
    outcomeReason: o.outcomeReason ?? null,
    canCancel: o.state === 'PLACED',
    promoCode: o.promoCode,
    placedAt: o.placedAt?.toISOString() ?? null,
    paymentDueAt: o.paymentDueAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    history: v.history.map((h) => ({ from: h.from, to: h.to, actorType: h.actorType, reason: h.reason, at: h.at.toISOString() })),
    payment: v.payment,
  };
};
