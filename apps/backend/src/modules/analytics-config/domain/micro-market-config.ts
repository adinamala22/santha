import { z } from 'zod';
import type { GeoPolygon } from '../../../common/geo/polygon';
import { everyDay, WeeklyHoursSchema } from '../../../common/hours';

const paise = z.number().int().nonnegative().describe('integer paise');

export const PolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.tuple([z.array(z.tuple([z.number(), z.number()])).min(4).max(500)]),
  })
  .describe('GeoJSON Polygon, one outer ring, [lng, lat] positions, first point repeated at the end');

/** Fee rules applied by cart-pricing (M4). All money in paise. */
export const FeeRulesSchema = z.object({
  deliveryBasePaise: paise,
  deliveryPerKmPaise: paise,
  freeDeliveryAbovePaise: paise,
  smallOrderThresholdPaise: paise,
  smallOrderFeePaise: paise,
  platformFeePaise: paise,
  /**
   * Extra delivery charge when the customer is beyond the store's radius but in the same city (ADR-022):
   * the per-km fee keeps counting and this flat amount is added. Never waived by free delivery.
   */
  beyondRadiusSurchargePaise: paise.default(3000),
  packagingFeeCapPaise: paise,
  /** GST on the platform's own fees (delivery, platform, small-order). Item prices are GST-inclusive (MRP rules). */
  gstOnFeesPercent: z.number().int().min(0).max(28).default(18),
  /** Cooked food from home kitchens: GST the platform collects as e-commerce operator (CGST s.9(5)), on food + packaging. */
  gstCookedFoodPercent: z.number().int().min(0).max(28).default(5),
  /** Commission ladder (M6): lower when the store delivers itself (it also keeps the delivery fee). */
  commissionSelfPercent: z.number().min(0).max(30).default(6),
  commissionRiderPercent: z.number().min(0).max(30).default(9),
  /** M7 settlement: GST on the commission invoice, GST TCS (s.52) and income-tax TDS (s.194-O). */
  gstOnCommissionPercent: z.number().min(0).max(28).default(18),
  tcsPercent: z.number().min(0).max(5).default(0.5),
  tdsPercent: z.number().min(0).max(5).default(0.1),
});

/** COD gating (PRD 8.6): retail/fashion only, capped order value; never cooked food. */
export const CodRulesSchema = z.object({
  enabled: z.boolean(),
  maxOrderPaise: paise,
  allowedTypes: z.array(z.enum(['retail', 'fashion'])),
});

export const SlaSchema = z.object({
  merchantAcceptSec: z.number().int().min(10).max(300),
  /** Hard accept window: an order still not accepted after this becomes EXPIRED (refunded). */
  merchantAcceptHardSec: z.number().int().min(30).max(900).default(120),
  etaBufferMin: z.number().int().min(0).max(60),
  riderFallbackMin: z.number().int().min(1).max(60),
  staleCatalogueHours: z.number().int().min(1).max(720),
});

/** A delivery target with a bonus (ADR-032): e.g. 10 deliveries in a day → Rs 150. */
export const IncentiveSchema = z.object({
  deliveries: z.number().int().min(1).max(200),
  bonusPaise: paise,
  period: z.enum(['day', 'week']),
});
export type Incentive = z.infer<typeof IncentiveSchema>;

export const RiderPaySchema = z.object({
  basePaise: paise,
  perKmPaise: paise,
  waitPerMinPaise: paise,
  batchBonusPaise: paise,
  /** COD cash a rider may hold before getting prepaid orders only; null = no limit (ADR-032). */
  cashLimitPaise: paise.nullable().default(null),
  /** Delivery targets with bonuses, paid in the rider payout (ADR-032). */
  incentives: z.array(IncentiveSchema).max(6).default([]),
});

const weight = z.number().min(0).max(1);

/**
 * search-discovery ranking and ETA v1 (PRD FR-DIS-1, FR-LOC-3; tech plan 7.5). Every key has a
 * default so versions written before M2 (stored as {}) parse.
 */
export const DiscoverySchema = z.object({
  weights: z
    .object({ distance: weight, eta: weight, rating: weight, acceptance: weight, freshness: weight })
    .default({ distance: 0.3, eta: 0.25, rating: 0.2, acceptance: 0.1, freshness: 0.15 }),
  /** Search: share of a store group's score that comes from text relevance (rest = store ranking). */
  textWeight: weight.default(0.6),
  /** Prep time used until a store has 30 days of orders (rolling p50 arrives with orders in M5). */
  defaultPrepMin: z
    .object({
      retail: z.number().int().min(0).max(120),
      fashion: z.number().int().min(0).max(120),
      home_business: z.number().int().min(0).max(240),
      home_kitchen: z.number().int().min(0).max(240),
    })
    .default({ retail: 10, fashion: 15, home_business: 20, home_kitchen: 30 }),
  /** ETA chip is shown as (eta − range, eta + range) minutes. */
  etaRangeMin: z.number().int().min(0).max(30).default(5),
  /** Rating assumed for stores without reviews yet. */
  newStoreRating: z.number().min(1).max(5).default(4.2),
});
export type Discovery = z.infer<typeof DiscoverySchema>;
export const DEFAULT_DISCOVERY: Discovery = DiscoverySchema.parse({});

/** Everything that is versioned per micro-market. */
export const MicroMarketConfigSchema = z.object({
  polygon: PolygonSchema,
  hours: WeeklyHoursSchema,
  fees: FeeRulesSchema,
  cod: CodRulesSchema,
  sla: SlaSchema,
  riderPay: RiderPaySchema,
  discovery: DiscoverySchema.default(DEFAULT_DISCOVERY),
});
export type MicroMarketConfig = Omit<z.infer<typeof MicroMarketConfigSchema>, 'polygon'> & { polygon: GeoPolygon };
export const CONFIG_FIELDS = ['polygon', 'hours', 'fees', 'cod', 'sla', 'riderPay', 'discovery'] as const;

/**
 * Pilot defaults for Nellore — placeholders until finance signs off the fee card (BRD 9).
 * Ops overrides any of these per micro-market by publishing a new version.
 */
export const DEFAULT_CONFIG: Omit<MicroMarketConfig, 'polygon'> = {
  hours: everyDay('07:00', '22:30'),
  fees: {
    deliveryBasePaise: 2500,
    deliveryPerKmPaise: 800,
    freeDeliveryAbovePaise: 19900,
    smallOrderThresholdPaise: 9900,
    smallOrderFeePaise: 1500,
    platformFeePaise: 500,
    beyondRadiusSurchargePaise: 3000,
    packagingFeeCapPaise: 2000,
    gstOnFeesPercent: 18,
    gstCookedFoodPercent: 5,
    commissionSelfPercent: 6,
    commissionRiderPercent: 9,
    gstOnCommissionPercent: 18,
    tcsPercent: 0.5,
    tdsPercent: 0.1,
  },
  cod: { enabled: true, maxOrderPaise: 150000, allowedTypes: ['retail', 'fashion'] },
  sla: { merchantAcceptSec: 20, merchantAcceptHardSec: 120, etaBufferMin: 8, riderFallbackMin: 5, staleCatalogueHours: 72 },
  riderPay: { basePaise: 3000, perKmPaise: 500, waitPerMinPaise: 100, batchBonusPaise: 1500, cashLimitPaise: null, incentives: [] },
  discovery: DEFAULT_DISCOVERY,
};

/** Names of the config sections that differ between two versions (for events and audit). */
export function changedFields(prev: MicroMarketConfig | null, next: MicroMarketConfig): string[] {
  if (!prev) return [...CONFIG_FIELDS];
  return CONFIG_FIELDS.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(next[f]));
}

/**
 * City-wide coverage (ADR-019). Off: an address is served only inside a micro-market area. On: an address in
 * none of them is served by the nearest micro-market of the city when it is within `maxDistanceM` of that
 * area (the store's own delivery radius still applies).
 */
export const CityCoverageSchema = z.object({
  nearestFallback: z.boolean().default(false),
  maxDistanceM: z.number().int().min(500).max(50_000).default(5000),
});
export type CityCoverage = z.infer<typeof CityCoverageSchema>;
export const DEFAULT_COVERAGE: CityCoverage = CityCoverageSchema.parse({});
