import type { WeeklyHours } from '../../../common/hours';
import type { LatLng } from '../../../common/geo/polygon';

/** One sellable item in the search index (collection `items`). Prices in paise. */
export interface ItemDoc {
  id: string;
  merchantId: string;
  microMarketId: string;
  merchantName: string;
  merchantType: 'retail' | 'fashion' | 'home_business' | 'home_kitchen';
  name: string;
  nameTe: string | null;
  brand: string | null;
  categorySlug: string;
  categoryName: string;
  categoryNameTe: string;
  foodMark: 'veg' | 'non_veg' | 'egg' | null;
  inStock: boolean;
  stale: boolean;
  /** Cheapest available size (or cheapest overall when all are out). */
  pricePaise: number;
  mrpPaise: number | null;
  variantCount: number;
  imageUrl: string | null;
  madeToOrder: boolean;
  specialOn: string | null;
  location: LatLng;
}

/** One live merchant (collection `merchants`), with what the feed and ranking need. */
export interface MerchantDoc {
  id: string;
  microMarketId: string;
  name: string;
  nameTe: string | null;
  type: ItemDoc['merchantType'];
  category: string | null;
  description: string | null;
  location: LatLng;
  radiusM: number;
  hours: WeeklyHours | null;
  selfDelivers: boolean;
  photoUrl: string | null;
  hasSlots: boolean;
  itemCount: number;
  staleItemCount: number;
  /** Most recent catalogue change/confirmation (ms since epoch); feeds the freshness term. */
  catalogueUpdatedAt: number;
  movPaise: number;
  hygieneDeclared: boolean;
  /** From reviews (M7); null until then. */
  rating: number | null;
  ratingCount: number;
  /** From order acceptance history (M5); null until then. */
  acceptanceRate: number | null;
  /** Rolling 30-day prep p50 in minutes (M5); null until then. */
  prepP50Min: number | null;
}
