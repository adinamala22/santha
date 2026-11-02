import { createZodDto } from 'nestjs-zod';
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
};

export class FeedQueryDto extends createZodDto(
  z.object({ ...Location, tab: z.enum(['stores', 'fashion', 'home_kitchens', 'home_businesses']).default('stores'), ...FilterFields }),
) {}
export class SearchQueryDto extends createZodDto(z.object({ ...Location, q: z.string().trim().min(1).max(80), ...FilterFields })) {}

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
