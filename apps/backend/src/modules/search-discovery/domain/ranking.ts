import type { Discovery } from '../../analytics-config/domain/micro-market-config';
import type { MerchantDoc } from './documents';

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export interface RankInput {
  doc: MerchantDoc;
  distanceM: number;
  /** null for scheduled-only home kitchens. */
  etaMin: number | null;
  now: Date;
  staleHours: number;
}

export interface RankBreakdown {
  score: number;
  terms: { distance: number; eta: number; rating: number; acceptance: number; freshness: number };
}

/**
 * Store ranking (PRD FR-DIS-1, tech plan 7.5): a weighted blend of distance, ETA, rating,
 * acceptance rate and catalogue freshness, each normalised to 0..1. Weights come from the
 * micro-market's discovery config. New stores get neutral defaults for rating and acceptance.
 */
export function rankStore(i: RankInput, d: Discovery): RankBreakdown {
  const distance = clamp(1 - i.distanceM / Math.max(i.doc.radiusM, 1));
  const eta = i.etaMin == null ? 0.5 : clamp(1 - (i.etaMin - 15) / 45);
  const rating = clamp(((i.doc.rating ?? d.newStoreRating) - 3) / 2);
  const acceptance = clamp(i.doc.acceptanceRate ?? 0.9);
  const staleShare = i.doc.itemCount ? i.doc.staleItemCount / i.doc.itemCount : 0;
  const hoursSince = (i.now.getTime() - i.doc.catalogueUpdatedAt) / 3_600_000;
  const recency = clamp(1 - hoursSince / Math.max(i.staleHours, 1));
  const freshness = 0.5 * (1 - staleShare) + 0.5 * recency;
  const terms = { distance, eta, rating, acceptance, freshness };
  const w = d.weights;
  const total = w.distance + w.eta + w.rating + w.acceptance + w.freshness || 1;
  const score = (w.distance * distance + w.eta * eta + w.rating * rating + w.acceptance * acceptance + w.freshness * freshness) / total;
  return { score, terms };
}

/** ETA chip range (tech plan 7.5: shown as ETA ± range), rounded to whole minutes, at least 5. */
export function etaRange(etaMin: number, rangeMin: number): { minMin: number; maxMin: number } {
  return { minMin: Math.max(5, Math.round(etaMin - rangeMin)), maxMin: Math.max(10, Math.round(etaMin + rangeMin)) };
}

/** Stale items are kept but pushed down (tech plan 7.6). */
export const STALE_ITEM_FACTOR = 0.8;
