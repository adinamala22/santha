import { createZodDto } from '../../../common/zod-dto';
import { z } from 'zod';
import type { NotificationRecord } from '../../notifications/notifications.repository';
import type { PaymentIntentRecord } from '../../payments-settlement/payments.repository';
import { BUCKETS, CANCEL_REASONS, type MerchantDaySummary, type MerchantOrderView, REJECT_REASONS } from '../lifecycle.service';
import type { OrderRecord, TransitionRecord } from '../orders.repository';

const iso = z.iso.datetime();
const int = z.number().int();
const BUCKET_NAMES = Object.keys(BUCKETS) as [keyof typeof BUCKETS, ...Array<keyof typeof BUCKETS>];

export class BucketQueryDto extends createZodDto(z.object({ bucket: z.enum(BUCKET_NAMES).default('new') })) {}
export class AcceptDto extends createZodDto(
  z.object({
    fulfilmentMode: z.enum(['self', 'rider']).optional().describe('Default: the store setting (fashion is always rider)'),
    staffId: z.uuid().optional().describe('Self delivery: which staff member delivers (they get the tracking link). Omit: the owner delivers.'),
  }),
) {}
export class RejectDto extends createZodDto(z.object({ reason: z.enum(REJECT_REASONS) })) {}
export class CancelOrderDto extends createZodDto(z.object({ reason: z.enum(CANCEL_REASONS) })) {}
export class ItemUnavailableDto extends createZodDto(
  z
    .object({
      action: z.enum(['remove', 'substitute']),
      itemId: z.uuid().optional().describe('substitute: an item from your store'),
      variantId: z.uuid().optional().describe('substitute: its size (same or lower price)'),
    })
    .refine((v) => v.action === 'remove' || (!!v.itemId && !!v.variantId), { message: 'A substitute needs itemId and variantId', path: ['itemId'] }),
) {}
export class OpsOrdersQueryDto extends createZodDto(
  z.object({ state: z.string().max(200).optional().describe('Comma-separated states'), microMarketId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }),
) {}

const LineSchema = z.object({
  itemId: z.uuid(),
  variantId: z.uuid(),
  name: z.string(),
  variantLabel: z.string(),
  quantity: int,
  unitPricePaise: int,
  linePaise: int,
  substitution: z.string(),
  status: z.enum(['ok', 'removed', 'substituted']),
  substituteName: z.string().nullable(),
  substituteVariantLabel: z.string().nullable(),
  substituteUnitPaise: int.nullable(),
  refundPaise: int,
});

const MerchantOrderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  state: z.string(),
  paymentMethod: z.enum(['online', 'cod']),
  fulfilmentMode: z.enum(['self', 'rider']).nullable(),
  itemCount: int,
  itemsPaise: int,
  totalPaise: int,
  refundedPaise: int,
  codDuePaise: int.describe('Cash to collect on delivery (COD orders, after removed items)'),
  when: z.object({ mode: z.enum(['asap', 'slot']), slotDate: z.string().nullable(), slotStartsAt: iso.nullable() }),
  distanceM: int,
  address: z.object({ line: z.string(), landmark: z.string().nullable() }).nullable().describe('Shown only after you accept'),
  instructions: z.string().nullable(),
  lines: z.array(LineSchema),
  placedAt: iso.nullable(),
  acceptBy: iso.nullable().describe('UI countdown (accept window)'),
  expiresAt: iso.nullable().describe('After this the order expires and is refunded'),
  acceptedAt: iso.nullable(),
  packBy: iso.nullable(),
  readyAt: iso.nullable(),
  outcomeReason: z.string().nullable(),
});
export class MerchantOrderDto extends createZodDto(MerchantOrderSchema) {}
export class MerchantOrderListDto extends createZodDto(
  z.object({
    items: z.array(MerchantOrderSchema),
    counts: z.object({ new: int, preparing: int, ready: int, out: int, done: int }),
    summary: z.object({ orders: int, itemsPaise: int, acceptanceRate: z.number().nullable(), avgPrepMin: int.nullable() }),
  }),
) {}

const isoOrNull = (d: Date | null | undefined) => d?.toISOString() ?? null;

const linesOut = (o: OrderRecord) =>
  o.lines.map((l) => ({
    itemId: l.itemId,
    variantId: l.variantId,
    name: l.name,
    variantLabel: l.variantLabel,
    quantity: l.quantity,
    unitPricePaise: l.unitPricePaise,
    linePaise: l.linePaise,
    substitution: l.substitution,
    status: l.status ?? 'ok',
    substituteName: l.substituteName ?? null,
    substituteVariantLabel: l.substituteVariantLabel ?? null,
    substituteUnitPaise: l.substituteUnitPaise ?? null,
    refundPaise: l.refundPaise ?? 0,
  }));

export const toMerchantOrderDto = (v: MerchantOrderView) => {
  const o = v.order;
  return {
    id: o.id,
    code: o.code,
    state: o.state,
    paymentMethod: o.paymentMethod,
    fulfilmentMode: o.fulfilmentMode,
    itemCount: o.lines.filter((l) => l.status !== 'removed').reduce((s, l) => s + l.quantity, 0),
    itemsPaise: o.itemsPaise,
    totalPaise: o.totalPaise,
    refundedPaise: o.refundedPaise,
    codDuePaise: o.paymentMethod === 'cod' && !['CANCELLED', 'REJECTED', 'EXPIRED'].includes(o.state) ? o.totalPaise - o.refundedPaise : 0,
    when: { mode: o.fulfilmentWhen, slotDate: o.slotDate, slotStartsAt: isoOrNull(o.slotStartsAt) },
    distanceM: v.distanceM,
    address: v.addressVisible ? { line: o.address.line, landmark: o.address.landmark } : null,
    instructions: v.addressVisible ? o.instructions : null,
    lines: linesOut(o),
    placedAt: isoOrNull(o.placedAt),
    acceptBy: isoOrNull(v.acceptBy),
    expiresAt: isoOrNull(v.expiresAt),
    acceptedAt: isoOrNull(o.acceptedAt),
    packBy: isoOrNull(o.packBy),
    readyAt: isoOrNull(o.readyAt),
    outcomeReason: o.outcomeReason,
  };
};

export const toMerchantListDto = (r: { items: MerchantOrderView[]; counts: Record<string, number>; summary: MerchantDaySummary }) => ({
  items: r.items.map(toMerchantOrderDto),
  counts: r.counts as { new: number; preparing: number; ready: number; out: number; done: number },
  summary: r.summary,
});

// ───────────── ops ─────────────

const OpsOrderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  state: z.string(),
  userId: z.uuid(),
  merchantId: z.uuid(),
  merchantName: z.string(),
  microMarketId: z.uuid(),
  paymentMethod: z.enum(['online', 'cod']),
  fulfilmentMode: z.string().nullable(),
  totalPaise: int,
  refundedPaise: int,
  itemCount: int,
  createdAt: iso,
  placedAt: iso.nullable(),
  outcomeReason: z.string().nullable(),
});
export class OpsOrderListDto extends createZodDto(z.object({ items: z.array(OpsOrderSchema) })) {}
export class OpsOrderDetailDto extends createZodDto(
  OpsOrderSchema.extend({
    lines: z.array(LineSchema),
    bill: z.unknown(),
    address: z.object({ line: z.string(), landmark: z.string().nullable() }),
    instructions: z.string().nullable(),
    history: z.array(z.object({ from: z.string().nullable(), to: z.string(), actorType: z.string(), actorId: z.string().nullable(), reason: z.string().nullable(), at: iso })),
    payment: z.object({ status: z.string(), provider: z.string(), providerOrderId: z.string(), providerPaymentId: z.string().nullable(), amountPaise: int, failureReason: z.string().nullable() }).nullable(),
    comms: z.array(z.object({ channel: z.string(), template: z.string(), locale: z.string(), body: z.string(), status: z.string(), provider: z.string(), error: z.string().nullable(), to: z.enum(['customer', 'merchant']), createdAt: iso })),
  }),
) {}

export const toOpsOrderDto = (o: OrderRecord, merchantName: string) => ({
  id: o.id,
  code: o.code,
  state: o.state,
  userId: o.userId,
  merchantId: o.merchantId,
  merchantName,
  microMarketId: o.microMarketId,
  paymentMethod: o.paymentMethod,
  fulfilmentMode: o.fulfilmentMode,
  totalPaise: o.totalPaise,
  refundedPaise: o.refundedPaise,
  itemCount: o.lines.reduce((s, l) => s + l.quantity, 0),
  createdAt: o.createdAt.toISOString(),
  placedAt: isoOrNull(o.placedAt),
  outcomeReason: o.outcomeReason,
});

export const toOpsOrderDetailDto = (
  o: OrderRecord,
  merchantName: string,
  history: TransitionRecord[],
  payment: PaymentIntentRecord | null,
  comms: NotificationRecord[],
) => ({
  ...toOpsOrderDto(o, merchantName),
  lines: linesOut(o),
  bill: (o.quote as { bill?: unknown }).bill ?? null,
  address: { line: o.address.line, landmark: o.address.landmark },
  instructions: o.instructions,
  history: history.map((h) => ({ from: h.from, to: h.to, actorType: h.actorType, actorId: h.actorId, reason: h.reason, at: h.at.toISOString() })),
  payment: payment && { status: payment.status, provider: payment.provider, providerOrderId: payment.providerOrderId, providerPaymentId: payment.providerPaymentId, amountPaise: payment.amountPaise, failureReason: payment.failureReason },
  comms: comms.map((c) => ({ channel: c.channel, template: c.template, locale: c.locale, body: c.body, status: c.status, provider: c.provider, error: c.error, to: c.userId === o.userId ? ('customer' as const) : ('merchant' as const), createdAt: c.createdAt.toISOString() })),
});
