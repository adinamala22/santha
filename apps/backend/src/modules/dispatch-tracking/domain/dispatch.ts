/**
 * Dispatch engine: pure functions (santha-backend "Key algorithms"). No I/O, no clock — callers pass
 * everything in, so every rule is unit-tested in dispatch.spec.ts.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** City two-wheeler speed used for ETAs until road times (Routes API) arrive: 18 km/h → 300 m/min. */
export const METRES_PER_MIN = 300;
export const travelMin = (metres: number) => Math.ceil(metres / METRES_PER_MIN);

// ───────────── scoring ─────────────

export interface Candidate {
  riderId: string;
  location: LatLng;
  /** Jobs the rider is carrying now (0 or 1; batching allows a second). */
  activeJobs: number;
  /** 1.0–5.0, null for a new rider (treated as 4.5). */
  rating: number | null;
  offersShown: number;
  offersAccepted: number;
}

export interface ScoreWeights {
  /** Penalty per km to the store. */
  distance: number;
  /** Penalty per active job. */
  load: number;
  /** Bonus per rating star above 4. */
  rating: number;
  /** Bonus for a perfect acceptance rate. */
  acceptance: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { distance: 10, load: 8, rating: 4, acceptance: 6 };

/** Max distance from the rider to the store for an offer (standby widens it). */
export const OFFER_RADIUS_M = 5_000;
export const STANDBY_RADIUS_M = 12_000;

export interface Scored extends Candidate {
  distanceM: number;
  score: number;
}

/**
 * Lower is better: distance to the store and current load cost; good ratings and a high acceptance
 * history help. Riders outside the radius, or already carrying two jobs, are dropped. Ties break on
 * rider id so the order is deterministic.
 */
export function score(
  candidates: readonly Candidate[],
  store: LatLng,
  w: ScoreWeights = DEFAULT_WEIGHTS,
  radiusM = OFFER_RADIUS_M,
): Scored[] {
  return candidates
    .map((c) => {
      const distanceM = haversineM(c.location, store);
      const acceptRate = c.offersShown === 0 ? 0.8 : c.offersAccepted / c.offersShown;
      const s =
        (distanceM / 1000) * w.distance +
        c.activeJobs * w.load -
        ((c.rating ?? 4.5) - 4) * w.rating -
        acceptRate * w.acceptance;
      return { ...c, distanceM: Math.round(distanceM), score: Math.round(s * 1000) / 1000 };
    })
    .filter((c) => c.distanceM <= radiusM && c.activeJobs < 2)
    .sort((a, b) => a.score - b.score || a.riderId.localeCompare(b.riderId));
}

// ───────────── batching ─────────────

export interface Leg {
  store: LatLng;
  drop: LatLng;
}

/** A second order may join a rider's trip only when it adds at most this many minutes to the first. */
export const MAX_BATCH_IMPACT_MIN = 6;

/**
 * Batch rule (architecture skill): ≤ 2 orders per trip, only when the detour for the first order's
 * customer is ≤ 6 min. Route: store A → store B → drop A → drop B (stores first, then the nearer drop).
 */
export function batchImpactMin(current: Leg, next: Leg): number {
  const direct = haversineM(current.store, current.drop);
  const viaNext = haversineM(current.store, next.store) + haversineM(next.store, current.drop);
  return Math.max(0, Math.ceil((viaNext - direct) / METRES_PER_MIN));
}

export const batchEligible = (current: Leg, next: Leg): boolean =>
  batchImpactMin(current, next) <= MAX_BATCH_IMPACT_MIN;

// ───────────── rider pay ─────────────

export interface RiderPayConfig {
  basePaise: number;
  perKmPaise: number;
  waitPerMinPaise: number;
  batchBonusPaise: number;
}

export interface PayLine {
  code: 'base' | 'distance' | 'wait' | 'batch';
  amountPaise: number;
}

/**
 * Deterministic rider pay: base + per-km on store → drop (rounded up to 0.1 km) + waiting at the store
 * beyond 5 free minutes + a batch bonus for the second order of a trip. Integer paise.
 */
export function riderPay(
  cfg: RiderPayConfig,
  input: { tripM: number; waitMin?: number; batched?: boolean },
): { totalPaise: number; lines: PayLine[] } {
  const km10 = Math.ceil(input.tripM / 100); // tenths of a km
  const lines: PayLine[] = [
    { code: 'base', amountPaise: cfg.basePaise },
    { code: 'distance', amountPaise: Math.round((km10 * cfg.perKmPaise) / 10) },
  ];
  const paidWait = Math.max(0, Math.floor(input.waitMin ?? 0) - 5);
  if (paidWait > 0) lines.push({ code: 'wait', amountPaise: paidWait * cfg.waitPerMinPaise });
  if (input.batched) lines.push({ code: 'batch', amountPaise: cfg.batchBonusPaise });
  return { totalPaise: lines.reduce((s, l) => s + l.amountPaise, 0), lines };
}

// ───────────── ETA ─────────────

/**
 * Promise shown to the customer: ready time (pack-by, or now + prep) + travel store → drop + buffer.
 * Live ETA during delivery: now + travel from the courier's position (via the store if not picked up).
 */
export function promisedAt(input: { readyBy: Date; storeToDropM: number; bufferMin: number }): Date {
  return new Date(input.readyBy.getTime() + (travelMin(input.storeToDropM) + input.bufferMin) * 60_000);
}

export function liveEta(input: {
  now: Date;
  courier: LatLng;
  store: LatLng;
  drop: LatLng;
  pickedUp: boolean;
  readyAt?: Date | null;
}): Date {
  if (input.pickedUp)
    return new Date(input.now.getTime() + travelMin(haversineM(input.courier, input.drop)) * 60_000);
  const toStore = new Date(input.now.getTime() + travelMin(haversineM(input.courier, input.store)) * 60_000);
  const leave = input.readyAt && input.readyAt > toStore ? input.readyAt : toStore;
  return new Date(leave.getTime() + travelMin(haversineM(input.store, input.drop)) * 60_000);
}

/** Tell the customer once when the live ETA slips this far past the promise. */
export const DELAY_NOTICE_MIN = 5;

// ───────────── fallback ladder ─────────────

/**
 * After `riderFallbackMin` with no rider: 3PL → self-delivery bonus for the store → standby pool
 * (wider radius) → tell the customer (new ETA or cancel with a full refund). Each later step follows
 * after FALLBACK_STEP_MIN if the earlier one did not find a courier.
 */
export const FALLBACK_STAGES = ['none', 'tpl', 'self_bonus', 'standby', 'customer_notified'] as const;
export type FallbackStage = (typeof FALLBACK_STAGES)[number];
export const FALLBACK_STEP_MIN = 2;

export function nextFallbackStage(stage: FallbackStage): FallbackStage | null {
  const i = FALLBACK_STAGES.indexOf(stage);
  return i < 0 || i === FALLBACK_STAGES.length - 1 ? null : FALLBACK_STAGES[i + 1]!;
}

/** Bonus offered to a store that delivers itself when no rider is found. */
export const SELF_DELIVERY_BONUS_PAISE = 2_000;

// ───────────── codes ─────────────

/** 4-digit codes from a random source (crypto in production, seeded in tests). */
export function fourDigits(rand: () => number): string {
  return String(Math.floor(rand() * 10_000)).padStart(4, '0');
}
