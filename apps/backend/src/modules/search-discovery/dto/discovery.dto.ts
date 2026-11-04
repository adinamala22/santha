import { createZodDto } from '../../../common/zod-dto';
import { z } from 'zod';
import type { StoreCard } from '../discovery.service';

const iso = z.iso.datetime();
const bool = z.enum(['true', 'false']).optional().transform((v) => v === 'true');

const Location = {
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
};
const FilterFields = {
  openNow: bool.describe('Only stores open now'),
  veg: bool.describe('Veg items only (search)'),
  selfDelivered: bool.describe('Only stores that deliver themselves'),
  maxEta: z.coerce.number().int().min(10).max(180).optional().describe('Delivers within N minutes (30/45/60)'),
  minRating: z.coerce.number().min(1).max(5).optional().describe('Only stores rated at least this (e.g. 4); unrated stores are left out'),
};

export class FeedQueryDto extends createZodDto(
  z.object({ ...Location, tab: z.enum(['stores', 'fashion', 'home_kitchens', 'home_businesses']).default('stores'), ...FilterFields }),
) {}
export class SearchQueryDto extends createZodDto(
  z
    .object({
      ...Location,
      q: z.string().trim().max(80).default(''),
      category: z.string().max(40).optional().describe('Category browse (platform taxonomy slug); q may be empty'),
      ...FilterFields,
    })
    .refine((v) => v.q.length > 0 || !!v.category, { message: 'Give a query or a category', path: ['q'] }),
) {}
export class StoreQueryDto extends createZodDto(z.object(Location)) {}

const Serviceability = z.object({
  serviceable: z.boolean(),
  microMarket: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), nameTe: z.string() }).nullable(),
});

export const StoreCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  nameTe: z.string().nullable(),
  type: z.enum(['retail', 'fashion', 'home_business', 'home_kitchen']),
  category: z.string().nullable(),
  photoUrl: z.string().nullable(),
  distanceM: z.number().int(),
  eta: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('asap'), minMin: z.number().int(), maxMin: z.number().int() }),
    z.object({
      mode: z.literal('scheduled'),
      nextSlot: z.object({ date: z.string(), start: z.string(), end: z.string(), cutoffAt: iso }).nullable(),
    }),
  ]),
  open: z.boolean(),
  nextOpenAt: iso.nullable(),
  closesAt: iso.nullable(),
  selfDelivers: z.boolean(),
  hygieneDeclared: z.boolean(),
  rating: z.number().nullable(),
  ratingCount: z.number().int(),
  movPaise: z.number().int(),
  itemCount: z.number().int(),
  score: z.number().describe('Ranking score 0..1 (for debugging ranking weights)'),
});

const ItemCardSchema = z.object({
  id: z.uuid(),
  merchantId: z.uuid(),
  variantId: z.uuid().describe('Default size for one-tap ADD'),
  variantLabel: z.string(),
  name: z.string(),
  nameTe: z.string().nullable(),
  brand: z.string().nullable(),
  categorySlug: z.string(),
  pricePaise: z.number().int(),
  mrpPaise: z.number().int().nullable(),
  foodMark: z.enum(['veg', 'non_veg', 'egg']).nullable(),
  imageUrl: z.string().nullable(),
  variantCount: z.number().int(),
  stale: z.boolean(),
  madeToOrder: z.boolean(),
});

export class FeedDto extends createZodDto(
  z.object({
    serviceability: Serviceability,
    tab: z.string(),
    tabs: z.array(z.object({ key: z.string(), count: z.number().int() })),
    stores: z.array(StoreCardSchema),
  }),
) {}

export class SearchDto extends createZodDto(
  z.object({
    serviceability: Serviceability,
    query: z.string(),
    hints: z.array(z.string()).describe('"Did you mean": synonyms and Telugu forms of the query'),
    groups: z.array(z.object({ store: StoreCardSchema, score: z.number(), items: z.array(ItemCardSchema), more: z.number().int() })),
    stores: z.array(StoreCardSchema).describe('Stores whose name matches the query'),
    totalItems: z.number().int(),
    zeroResult: z.boolean(),
    tookMs: z.number().int(),
  }),
) {}

const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;
export const toStoreDto = (c: StoreCard) => ({
  ...c,
  nextOpenAt: isoOrNull(c.nextOpenAt),
  closesAt: isoOrNull(c.closesAt),
  eta: c.eta.mode === 'asap' ? c.eta : { mode: 'scheduled' as const, nextSlot: c.eta.nextSlot ? { ...c.eta.nextSlot, cutoffAt: c.eta.nextSlot.cutoffAt.toISOString() } : null },
});

const StoreItemSchema = ItemCardSchema.extend({
  description: z.string().nullable(),
  allergens: z.array(z.string()),
  leadTimeMin: z.number().int().nullable(),
  maxPerOrder: z.number().int().nullable(),
  stock: z.enum(['in', 'low', 'out']),
  variants: z.array(z.object({ id: z.uuid(), label: z.string(), pricePaise: z.number().int(), mrpPaise: z.number().int().nullable(), stock: z.enum(['in', 'low', 'out']) })),
  onMenuToday: z.boolean().describe('Home kitchens: on today\'s menu'),
  dailyCapacity: z.number().int().nullable().describe('Portions per day (left = capacity − ordered, from M4)'),
  special: z.boolean().describe("Today's special"),
});
const OccurrenceSchema = z.object({
  slotId: z.uuid(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  startsAt: iso,
  cutoffAt: iso,
  capacity: z.number().int(),
  booked: z.number().int(),
  state: z.enum(['open', 'closed', 'full']),
});
export class StoreDto extends createZodDto(
  z.object({
    store: StoreCardSchema,
    description: z.string().nullable(),
    microMarket: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), nameTe: z.string() }).nullable(),
    deliversHere: z.boolean().describe('Inside the store radius and the same micro-market as the customer'),
    deliveryRadiusM: z.number().int().describe('How far the store delivers'),
    notDeliveringReason: z.enum(['outside_service_area', 'other_area', 'too_far']).nullable(),
    photos: z.array(z.object({ thumbUrl: z.string().nullable(), mediumUrl: z.string().nullable() })),
    fssaiVerified: z.boolean(),
    hygieneDeclared: z.boolean(),
    returnPolicy: z.string().nullable(),
    freeDeliveryAbovePaise: z.number().int(),
    categories: z.array(z.object({ slug: z.string(), name: z.string(), nameTe: z.string(), count: z.number().int() })),
    items: z.array(StoreItemSchema),
    slots: z.object({ occurrences: z.array(OccurrenceSchema), nextOpen: OccurrenceSchema.nullable() }).nullable(),
    generatedAt: iso,
  }),
) {}

type Occ = { slotId: string; date: string; start: string; end: string; startsAt: Date; cutoffAt: Date; capacity: number; booked: number; state: 'open' | 'closed' | 'full' };
const occ = (o: Occ) => ({ ...o, startsAt: o.startsAt.toISOString(), cutoffAt: o.cutoffAt.toISOString() });
export const toStorePageDto = <T extends { store: StoreCard; slots: { occurrences: Occ[]; nextOpen: Occ | null } | null; generatedAt: Date }>(r: T) => ({
  ...r,
  store: toStoreDto(r.store),
  slots: r.slots ? { occurrences: r.slots.occurrences.map(occ), nextOpen: r.slots.nextOpen ? occ(r.slots.nextOpen) : null } : null,
  generatedAt: r.generatedAt.toISOString(),
});
