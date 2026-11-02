import type {
  FoodMark,
  ItemSource,
  ItemStatus,
  ItemUnit,
  MasterSource,
  MediaStatus,
  StockState,
} from '@prisma/client';
import { DAYS, type Day, istInstant, istParts } from '../../../common/hours';
import type { MerchantRecord } from './merchant';
import { categoryAllowed } from './taxonomy';

export type { FoodMark, ItemSource, ItemStatus, ItemUnit, MasterSource, MediaStatus, StockState };

export const ITEM_UNITS = [
  'kg',
  'g',
  'l',
  'ml',
  'pc',
  'pack',
  'portion',
] as const satisfies readonly ItemUnit[];
export const STOCK_STATES = ['in', 'low', 'out'] as const satisfies readonly StockState[];
export const FOOD_MARKS = ['veg', 'non_veg', 'egg'] as const satisfies readonly FoodMark[];

/** The 14 allergens food labels must declare (FSSAI labelling regulations, PRD FR-TRS-2). */
export const ALLERGENS = [
  'gluten',
  'milk',
  'egg',
  'peanut',
  'tree_nuts',
  'soy',
  'fish',
  'shellfish',
  'sesame',
  'mustard',
  'celery',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const MAX_VARIANTS = 10;
export const MAX_IMAGES = 6;
export const MAX_STORE_PHOTOS = 6;
export const MAX_SLOTS = 12;

export interface VariantRecord {
  id: string;
  itemId: string;
  label: string;
  unit: ItemUnit;
  unitQty: number;
  pricePaise: number;
  mrpPaise: number | null;
  stock: StockState;
  position: number;
}

export interface ItemRecord {
  id: string;
  merchantId: string;
  microMarketId: string | null;
  masterProductId: string | null;
  name: string;
  nameTe: string | null;
  description: string | null;
  brand: string | null;
  categorySlug: string;
  foodMark: FoodMark | null;
  allergens: string[];
  madeToOrder: boolean;
  leadTimeMin: number | null;
  maxPerOrder: number | null;
  availableDays: Day[];
  dailyCapacity: number | null;
  specialOn: string | null;
  status: ItemStatus;
  reviewReason: string | null;
  source: ItemSource;
  imageIds: string[];
  confirmedAt: Date;
  staleSince: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  variants: VariantRecord[];
}

export interface MasterProductRecord {
  id: string;
  barcode: string;
  name: string;
  brand: string | null;
  mrpPaise: number | null;
  packLabel: string | null;
  unit: ItemUnit | null;
  unitQty: number | null;
  categorySlug: string;
  imageUrl: string | null;
  source: MasterSource;
  createdAt: Date;
  updatedAt: Date;
}

export interface BarcodeRequestRecord {
  id: string;
  barcode: string;
  scanCount: number;
  lastMerchantId: string | null;
  status: 'open' | 'resolved';
  masterProductId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface SlotRecord {
  id: string;
  merchantId: string;
  label: string | null;
  days: Day[];
  start: string;
  end: string;
  cutoffMin: number;
  capacity: number;
  position: number;
}

export interface MediaVariant {
  key: string;
  width: number;
  height: number;
  bytes: number;
}

export interface MediaRecord {
  id: string;
  merchantId: string;
  purpose: 'item' | 'store';
  status: MediaStatus;
  contentType: string;
  originalKey: string;
  variants: { thumb: MediaVariant; medium: MediaVariant } | null;
  rejectReason: string | null;
  uploadedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

// ───────────── rules ─────────────

export interface VariantInput {
  id?: string | undefined;
  label: string;
  unit: ItemUnit;
  unitQty: number;
  pricePaise: number;
  mrpPaise?: number | null | undefined;
  stock?: StockState | undefined;
}

export interface ItemProblem {
  field: string;
  message: string;
}

export interface ItemDraft {
  name: string;
  categorySlug: string;
  foodMark: FoodMark | null;
  allergens: string[];
  madeToOrder: boolean;
  leadTimeMin: number | null;
  variants: VariantInput[];
  /** MRP printed on the pack (master product) — every variant's MRP defaults to and may not exceed it. */
  packagedMrpPaise: number | null;
}

/** Categories that hold food: their items carry a veg / non-veg / egg mark (PRD FR-TRS-2). */
export const FOOD_CATEGORIES: ReadonlySet<string> = new Set([
  'staples',
  'oils_ghee',
  'masala',
  'dairy',
  'breakfast',
  'snacks',
  'biscuits',
  'beverages',
  'fruits',
  'vegetables',
  'meat_fish',
  'eggs',
  'bakery',
  'pickles',
  'sweets',
  'cakes',
  'meals',
  'tiffins',
  'curries',
  'biryani',
  'kitchen_snacks',
  'kitchen_sweets',
]);

/** Home kitchens label everything; other food sellers label items in food categories. */
export const needsFoodMark = (m: Pick<MerchantRecord, 'type' | 'sellsFood'>, categorySlug: string) =>
  m.type === 'home_kitchen' || (m.sellsFood && FOOD_CATEGORIES.has(categorySlug));

/**
 * Validates an item before it is stored (FR-CAT-2, FR-CAT-6). Returns every problem at once so
 * the app and the CSV import can show them together.
 */
export function itemProblems(m: Pick<MerchantRecord, 'type' | 'sellsFood'>, d: ItemDraft): ItemProblem[] {
  const p: ItemProblem[] = [];
  if (d.name.trim().length < 2) p.push({ field: 'name', message: 'Name is too short' });
  if (!categoryAllowed(d.categorySlug, m.type))
    p.push({ field: 'categorySlug', message: 'Pick a category for your type of store' });
  if (d.variants.length === 0) p.push({ field: 'variants', message: 'Add at least one size or price' });
  if (d.variants.length > MAX_VARIANTS)
    p.push({ field: 'variants', message: `Up to ${MAX_VARIANTS} sizes per item` });
  const labels = new Set<string>();
  d.variants.forEach((v, i) => {
    const f = `variants.${i}`;
    if (!Number.isInteger(v.pricePaise) || v.pricePaise <= 0)
      p.push({ field: `${f}.pricePaise`, message: 'Price must be more than ₹0' });
    const mrp = v.mrpPaise ?? d.packagedMrpPaise;
    if (mrp != null && v.pricePaise > mrp)
      p.push({ field: `${f}.pricePaise`, message: 'Selling price cannot be more than the MRP' });
    if (d.packagedMrpPaise != null && v.mrpPaise != null && v.mrpPaise > d.packagedMrpPaise)
      p.push({ field: `${f}.mrpPaise`, message: 'MRP cannot be more than the MRP printed on the pack' });
    if (!(v.unitQty > 0)) p.push({ field: `${f}.unitQty`, message: 'Quantity must be more than 0' });
    const key = v.label.trim().toLowerCase();
    if (!key) p.push({ field: `${f}.label`, message: 'Name each size, e.g. "500 g"' });
    else if (labels.has(key)) p.push({ field: `${f}.label`, message: 'Two sizes have the same name' });
    labels.add(key);
  });
  if (needsFoodMark(m, d.categorySlug) && !d.foodMark)
    p.push({ field: 'foodMark', message: 'Mark the item veg, non-veg or egg' });
  const bad = d.allergens.filter((a) => !(ALLERGENS as readonly string[]).includes(a));
  if (bad.length) p.push({ field: 'allergens', message: `Unknown allergens: ${bad.join(', ')}` });
  if (d.madeToOrder && !(d.leadTimeMin && d.leadTimeMin > 0))
    p.push({ field: 'leadTimeMin', message: 'Made-to-order items need a lead time' });
  return p;
}

/** Item stock for listing: in if any variant is in, low if only low ones, else out. */
export function itemStock(variants: Pick<VariantRecord, 'stock'>[]): StockState {
  if (variants.some((v) => v.stock === 'in')) return 'in';
  if (variants.some((v) => v.stock === 'low')) return 'low';
  return 'out';
}

/** Staleness (tech plan 7.6): untouched for `hours` → flagged; any confirmation clears it. */
export const isStaleAt = (i: Pick<ItemRecord, 'confirmedAt'>, now: Date, hours: number) =>
  now.getTime() - i.confirmedAt.getTime() >= hours * 3600_000;

/** Visible to consumers: approved for sale and not deleted. Stock is shown separately. */
export const isSellable = (i: Pick<ItemRecord, 'status' | 'deletedAt'>) =>
  i.status === 'active' && !i.deletedAt;

// ───────────── kitchen slots (FR-CAT-5) ─────────────

export interface SlotInput {
  label?: string | null | undefined;
  days: Day[];
  start: string;
  end: string;
  cutoffMin: number;
  capacity: number;
}

export function slotProblems(slots: SlotInput[]): ItemProblem[] {
  const p: ItemProblem[] = [];
  if (slots.length > MAX_SLOTS) p.push({ field: 'slots', message: `Up to ${MAX_SLOTS} slots` });
  slots.forEach((s, i) => {
    if (s.start >= s.end) p.push({ field: `slots.${i}.end`, message: 'Slot must end after it starts' });
    if (!s.days.length) p.push({ field: `slots.${i}.days`, message: 'Pick at least one day' });
    if (s.capacity < 1) p.push({ field: `slots.${i}.capacity`, message: 'Capacity must be at least 1' });
  });
  for (const d of DAYS) {
    const day = slots
      .map((s, i) => ({ ...s, i }))
      .filter((s) => s.days.includes(d))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (let k = 1; k < day.length; k++)
      if (day[k]!.start < day[k - 1]!.end)
        p.push({ field: `slots.${day[k]!.i}.start`, message: `Overlaps another slot on ${d}` });
  }
  return p;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export interface SlotOccurrence {
  slotId: string;
  date: string;
  start: string;
  end: string;
  startsAt: Date;
  cutoffAt: Date;
  capacity: number;
  booked: number;
  /** open = can still be ordered; closed = past cut-off; full = capacity reached. */
  state: 'open' | 'closed' | 'full';
}

/**
 * Slot occurrences for the next `days` days from `now`, with their state. Ordering past cut-off or
 * capacity is blocked and the next open occurrence is shown instead (FR-CAT-5). `booked` counts
 * come from orders (M4); until then they are zero.
 */
export function slotOccurrences(
  slots: SlotRecord[],
  now: Date,
  days = 2,
  booked: (slotId: string, date: string) => number = () => 0,
): { occurrences: SlotOccurrence[]; nextOpen: SlotOccurrence | null } {
  const out: SlotOccurrence[] = [];
  for (let d = 0; d < days; d++) {
    const { date, day } = istParts(new Date(now.getTime() + d * 86_400_000));
    for (const s of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
      if (!s.days.includes(day)) continue;
      const startsAt = istInstant(date, s.start);
      const cutoffAt = new Date(startsAt.getTime() - s.cutoffMin * 60_000);
      const b = booked(s.id, date);
      const state = now >= cutoffAt ? 'closed' : b >= s.capacity ? 'full' : 'open';
      out.push({
        slotId: s.id,
        date,
        start: s.start,
        end: s.end,
        startsAt,
        cutoffAt,
        capacity: s.capacity,
        booked: b,
        state,
      });
    }
  }
  return { occurrences: out, nextOpen: out.find((o) => o.state === 'open') ?? null };
}

export const slotMinutes = (s: Pick<SlotRecord, 'start' | 'end'>) => toMin(s.end) - toMin(s.start);
