import { createZodDto } from '../../../common/zod-dto';
import { z } from 'zod';

const int = z.number().int();
const iso = z.string().describe('ISO-8601 timestamp');
const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const payLine = z.object({ code: z.enum(['base', 'distance', 'wait', 'batch']), amountPaise: int });

// ───────────── inputs ─────────────

export class RiderStatusDto extends createZodDto(
  z.object({
    online: z.boolean(),
    zones: z
      .array(z.uuid())
      .max(10)
      .optional()
      .describe('Micro-markets to work in; omit to keep the current ones (empty = all)'),
  }),
) {}
export class LocationDto extends createZodDto(
  latLng.extend({ accuracyM: z.number().min(0).max(5000).optional() }),
) {}
/** Why a delivery could not be handed over (ADR-026). */
export const FAILED_REASONS = ['no_answer', 'wrong_address', 'customer_refused', 'unsafe', 'other'] as const;

export class FailedDeliveryDto extends createZodDto(
  z.object({
    reason: z.enum(FAILED_REASONS),
    note: z.string().trim().max(300).optional().describe('What happened, in a few words'),
  }),
) {}

/** Ops ends a failed delivery: the order is cancelled, with or without giving the customer their money back. */
export class OpsCancelFailedDto extends createZodDto(
  z.object({
    refund: z.boolean().describe('Refund what the customer paid (wallet for online payments)'),
    reason: z.string().trim().min(3).max(300),
  }),
) {}

export class PickupDto extends createZodDto(
  z.object({
    pickupCode: z
      .string()
      .regex(/^\d{4}$/)
      .describe('Code shown on the store order card'),
  }),
) {}
export class DeliveredDto extends createZodDto(
  z
    .object({
      otp: z
        .string()
        .regex(/^\d{4}$/)
        .optional()
        .describe("Customer's 4-digit delivery OTP"),
      photoMediaId: z.uuid().optional().describe('No-contact delivery: photo at the door'),
      codCollectedPaise: int.min(0).max(10_000_000).optional().describe('Cash collected for COD orders'),
    })
    .refine((v) => v.otp || v.photoMediaId, { message: 'Enter the OTP or take a photo', path: ['otp'] }),
) {}
export class StaffDeliveredDto extends createZodDto(
  z.object({ otp: z.string().regex(/^\d{4}$/), codCollectedPaise: int.min(0).max(10_000_000).optional() }),
) {}
export class DeliverMyselfDto extends createZodDto(
  z.object({ staffId: z.uuid().optional().describe('Omit: the owner delivers') }),
) {}
export class ReassignDto extends createZodDto(z.object({ riderUserId: z.uuid() })) {}
export class StatementQueryDto extends createZodDto(
  z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('IST day, default today'),
  }),
) {}

// ───────────── rider views ─────────────

export const OfferViewSchema = z.object({
  id: z.uuid(),
  expiresAt: iso,
  payPaise: int,
  payLines: z.array(payLine),
  pickup: z.object({ name: z.string(), distanceM: int, readyInMin: int.nullable() }),
  drop: z.object({ area: z.string(), distanceM: int }),
});

export const JobViewSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  code: z.string(),
  mode: z.enum(['self', 'rider', 'tpl']),
  state: z.enum(['searching', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled']),
  orderState: z.string(),
  store: z.object({ name: z.string(), line: z.string().nullable(), lat: z.number(), lng: z.number() }),
  drop: z.object({
    name: z.string().nullable(),
    line: z.string(),
    landmark: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
  }),
  instructions: z.string().nullable(),
  itemCount: int,
  codDuePaise: int,
  payPaise: int,
  payLines: z.array(payLine),
  /** Masked number to reach the customer (Exotel); never the real phone. */
  callNumber: z.string(),
  readyAt: iso.nullable(),
  arrivedAt: iso.nullable(),
  pickedUpAt: iso.nullable(),
  deliveredAt: iso.nullable(),
  /** Riders must enter the store's pickup code; staff do not. */
  pickupCodeRequired: z.boolean(),
  /** Couldn't deliver (ADR-026): why, while the job waits for a retry or ops. */
  failedReason: z.enum(FAILED_REASONS).nullable(),
  failedAt: iso.nullable(),
  arrivedDropAt: iso.nullable().describe("When the courier marked arrived at the customer's door (ADR-030)"),
  photoProofAllowed: z.boolean().describe('A door photo may replace the OTP: prepaid, up to ₹2,000, after arriving (ADR-030)'),
});
export class JobViewDto extends createZodDto(JobViewSchema) {}

export class RiderHomeDto extends createZodDto(
  z.object({
    name: z.string(),
    vehicle: z.string(),
    online: z.boolean(),
    zones: z.array(z.object({ id: z.uuid(), name: z.string(), nameTe: z.string() })),
    allZones: z.array(z.object({ id: z.uuid(), name: z.string(), nameTe: z.string() })),
    rating: z.number().nullable(),
    status: z
      .enum(['draft', 'submitted', 'approved', 'rejected', 'suspended'])
      .describe('Onboarding (ADR-029): only approved riders go online'),
    statusNote: z.string().nullable().describe('Why ops rejected or paused the rider'),
    today: z.object({ deliveries: int, earningsPaise: int, onlineMin: int }),
    cashInHandPaise: int.describe('COD cash collected this payout period; the next payout deducts it'),
    acceptancePct: int.nullable().describe('Offers accepted ÷ shown, in %; null before the first offer'),
    offer: OfferViewSchema.nullable(),
    jobs: z.array(JobViewSchema),
  }),
) {}

export class RiderEarningsDto extends createZodDto(
  z.object({
    totalPaise: int,
    onlineMin: int,
    deliveries: z.array(
      z.object({ code: z.string(), deliveredAt: iso, payPaise: int, payLines: z.array(payLine) }),
    ),
  }),
) {}

// ───────────── customer tracking ─────────────

export class TrackingDto extends createZodDto(
  z.object({
    orderId: z.uuid(),
    mode: z.enum(['self', 'rider', 'tpl']),
    state: z.enum(['searching', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled']),
    courier: z
      .object({ kind: z.enum(['staff', 'owner', 'rider', 'tpl']), name: z.string(), callNumber: z.string() })
      .nullable(),
    /** Give this to the courier at the door. Shown once a courier is assigned. */
    deliveryOtp: z.string().nullable(),
    store: z.object({ name: z.string(), lat: z.number(), lng: z.number() }),
    drop: z.object({ lat: z.number(), lng: z.number() }),
    courierLocation: z.object({ lat: z.number(), lng: z.number(), at: iso }).nullable(),
    promisedAt: iso,
    etaAt: iso.nullable(),
    fallbackStage: z.enum(['none', 'tpl', 'self_bonus', 'standby', 'customer_notified']),
    /** No courier found after the fallback ladder: the customer may cancel for a full refund. */
    canCancelNoCourier: z.boolean(),
    arrivedDropAt: iso.nullable().describe('The courier is at the door'),
    proofPhotoUrl: z.string().nullable().describe('Delivered with a door photo: a short-lived link to it (ADR-030)'),
  }),
) {}

// ───────────── merchant ─────────────

export const MerchantDeliverySchema = z.object({
  orderId: z.uuid(),
  mode: z.enum(['self', 'rider', 'tpl']),
  state: z.enum(['searching', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled']),
  pickupCode: z.string(),
  courier: z
    .object({ kind: z.enum(['staff', 'owner', 'rider', 'tpl']), name: z.string(), callNumber: z.string() })
    .nullable(),
  /** Self delivery: the tokenised tracking link (also sent to the staff member by SMS). */
  staffLink: z.string().nullable(),
  /** Customer's OTP, only for the owner delivering themselves (no staff link). */
  deliveryOtp: z.string().nullable(),
  fallbackStage: z.enum(['none', 'tpl', 'self_bonus', 'standby', 'customer_notified']),
  selfBonusPaise: int,
  promisedAt: iso,
  etaAt: iso.nullable(),
});
export class MerchantDeliveryDto extends createZodDto(MerchantDeliverySchema) {}
export class MerchantDeliveryListDto extends createZodDto(
  z.object({ items: z.array(MerchantDeliverySchema) }),
) {}

export class StatementPreviewDto extends createZodDto(
  z.object({
    date: z.string(),
    lines: z.array(
      z.object({
        orderId: z.uuid(),
        code: z.string(),
        deliveredAt: iso,
        mode: z.enum(['self', 'rider', 'tpl']),
        itemsPaise: int,
        commissionPercent: z.number(),
        commissionPaise: int,
        deliveryFeeCreditPaise: int,
        selfBonusPaise: int,
        netPaise: int,
      }),
    ),
    totals: z.object({
      orders: int,
      itemsPaise: int,
      commissionPaise: int,
      deliveryFeeCreditPaise: int,
      selfBonusPaise: int,
      netPaise: int,
    }),
  }),
) {}

// ───────────── ops ─────────────

export const OpsDeliverySchema = z.object({
  orderId: z.uuid(),
  code: z.string(),
  microMarketId: z.uuid(),
  merchantName: z.string(),
  orderState: z.string(),
  totalPaise: int,
  paymentMethod: z.enum(['online', 'cod']),
  mode: z.enum(['self', 'rider', 'tpl']).nullable(),
  fulfilmentState: z
    .enum(['searching', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled'])
    .nullable(),
  courier: z.string().nullable(),
  fallbackStage: z.string().nullable(),
  searchingSec: int.nullable(),
  promisedAt: iso.nullable(),
  etaAt: iso.nullable(),
  store: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});

export class OpsLiveDto extends createZodDto(
  z.object({
    at: iso,
    kpis: z.object({
      ordersToday: int,
      activeNow: int,
      onTimePercent: z.number().nullable(),
      fillRatePercent: z.number().nullable(),
      ridersOnline: int,
      avgAcceptSec: z.number().nullable(),
    }),
    attention: z.array(
      z.object({
        kind: z.enum(['no_rider', 'eta_breach', 'auto_paused', 'delivery_failed']),
        orderId: z.uuid().nullable(),
        code: z.string().nullable(),
        merchantName: z.string(),
        minutes: int,
        stage: z.string().nullable(),
      }),
    ),
    orders: z.array(OpsDeliverySchema),
    riders: z.array(
      z.object({
        userId: z.uuid(),
        name: z.string(),
        online: z.boolean(),
        lat: z.number().nullable(),
        lng: z.number().nullable(),
        activeJobs: int,
      }),
    ),
  }),
) {}
export class OpsDeliveryDto extends createZodDto(OpsDeliverySchema) {}
