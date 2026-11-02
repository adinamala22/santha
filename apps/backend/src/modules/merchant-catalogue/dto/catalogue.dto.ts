import { createZodDto } from '../../../common/zod-dto';
import { z } from 'zod';
import { DAYS } from '../../../common/hours';
import type { ImportReport, ItemView } from '../catalogue.service';
import { ALLERGENS, FOOD_MARKS, ITEM_UNITS, type MasterProductRecord, MAX_IMAGES, MAX_VARIANTS, type SlotRecord, STOCK_STATES } from '../domain/catalogue';
import type { Category } from '../domain/taxonomy';
import { UPLOAD_TYPES } from '../media.service';
import { MediaSchema, toMediaDto } from './merchants.dto';

const iso = z.iso.datetime();
const paise = z.number().int().positive().max(10_000_000).describe('integer paise');
const day = z.enum(DAYS);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const itemStatus = z.enum(['pending_merchant', 'in_review', 'active', 'hidden']);
const stock = z.enum(STOCK_STATES);

export const VariantInputSchema = z.object({
  id: z.uuid().optional().describe('Existing variant (keep its id when editing)'),
  label: z.string().trim().min(1).max(40).describe('"500 g", "Large", "Serves 2"'),
  unit: z.enum(ITEM_UNITS),
  unitQty: z.number().positive().max(100_000),
  pricePaise: paise,
  mrpPaise: paise.nullable().optional().describe('Printed MRP; selling price may not exceed it (FR-CAT-6)'),
  stock: stock.optional(),
});

const ItemFields = {
  name: z.string().trim().min(2).max(120),
  nameTe: z.string().trim().max(120).nullable(),
  description: z.string().trim().max(1000).nullable(),
  brand: z.string().trim().max(60).nullable(),
  categorySlug: z.string().max(40),
  foodMark: z.enum(FOOD_MARKS).nullable(),
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
  madeToOrder: z.boolean(),
  leadTimeMin: z.number().int().min(1).max(7 * 24 * 60).nullable(),
  maxPerOrder: z.number().int().min(1).max(100).nullable(),
  availableDays: z.array(day).max(7).describe('Home kitchens: menu days (empty = every day)'),
  dailyCapacity: z.number().int().min(1).max(1000).nullable().describe('Home kitchens: portions per day'),
  specialOn: z.iso.date().nullable().describe("Home kitchens: the date it is today's special"),
  imageIds: z.array(z.uuid()).max(MAX_IMAGES),
  variants: z.array(VariantInputSchema).min(1).max(MAX_VARIANTS),
};

export const CreateItemSchema = z.object({
  masterProductId: z.uuid().nullable().optional().describe('From a barcode scan or master search; pre-fills name, brand, category, MRP'),
  ...ItemFields,
  name: ItemFields.name.optional(),
  categorySlug: ItemFields.categorySlug.optional(),
}).partial({ nameTe: true, description: true, brand: true, foodMark: true, allergens: true, madeToOrder: true, leadTimeMin: true, maxPerOrder: true, availableDays: true, dailyCapacity: true, specialOn: true, imageIds: true });
export class CreateItemDto extends createZodDto(CreateItemSchema) {}

export const UpdateItemSchema = z.object({ ...ItemFields, hidden: z.boolean().describe('Hide from customers without deleting') }).partial();
export class UpdateItemDto extends createZodDto(UpdateItemSchema) {}

export class StockDto extends createZodDto(z.object({ stock, variantId: z.uuid().nullable().optional().describe('Omit for every size') })) {}

export const ItemQuerySchema = z.object({
  status: itemStatus.optional(),
  q: z.string().trim().max(60).optional(),
  category: z.string().max(40).optional(),
  stale: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export class ItemQueryDto extends createZodDto(ItemQuerySchema) {}

export const VariantSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  unit: z.enum(ITEM_UNITS),
  unitQty: z.number(),
  pricePaise: z.number().int(),
  mrpPaise: z.number().int().nullable(),
  stock,
});

export const ItemSchema = z.object({
  id: z.uuid(),
  merchantId: z.uuid(),
  masterProductId: z.uuid().nullable(),
  name: z.string(),
  nameTe: z.string().nullable(),
  description: z.string().nullable(),
  brand: z.string().nullable(),
  categorySlug: z.string(),
  foodMark: z.enum(FOOD_MARKS).nullable(),
  allergens: z.array(z.string()),
  madeToOrder: z.boolean(),
  leadTimeMin: z.number().int().nullable(),
  maxPerOrder: z.number().int().nullable(),
  availableDays: z.array(day),
  dailyCapacity: z.number().int().nullable(),
  specialOn: z.string().nullable(),
  status: itemStatus,
  reviewReason: z.string().nullable(),
  source: z.enum(['merchant', 'master', 'import', 'ops']),
  images: z.array(MediaSchema),
  imageUrl: z.string().nullable(),
  stock,
  stale: z.boolean().describe('Not confirmed within the staleness window (72 h); confirm to clear'),
  confirmedAt: iso,
  variants: z.array(VariantSchema),
  createdAt: iso,
  updatedAt: iso,
});
export class ItemDto extends createZodDto(ItemSchema) {}
export class ItemPageDto extends createZodDto(z.object({ items: z.array(ItemSchema), total: z.number().int() })) {}

export const toItemDto = (v: ItemView) => {
  const i = v.item;
  return {
    id: i.id,
    merchantId: i.merchantId,
    masterProductId: i.masterProductId,
    name: i.name,
    nameTe: i.nameTe,
    description: i.description,
    brand: i.brand,
    categorySlug: i.categorySlug,
    foodMark: i.foodMark,
    allergens: i.allergens,
    madeToOrder: i.madeToOrder,
    leadTimeMin: i.leadTimeMin,
    maxPerOrder: i.maxPerOrder,
    availableDays: i.availableDays,
    dailyCapacity: i.dailyCapacity,
    specialOn: i.specialOn,
    status: i.status,
    reviewReason: i.reviewReason,
    source: i.source,
    images: v.images.map(toMediaDto),
    imageUrl: v.imageUrl,
    stock: v.stock,
    stale: v.stale,
    confirmedAt: i.confirmedAt.toISOString(),
    variants: i.variants.map((x) => ({ id: x.id, label: x.label, unit: x.unit, unitQty: x.unitQty, pricePaise: x.pricePaise, mrpPaise: x.mrpPaise, stock: x.stock })),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
};

// ── master catalogue + barcode ──

export const MasterProductSchema = z.object({
  id: z.uuid(),
  barcode: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  mrpPaise: z.number().int().nullable(),
  packLabel: z.string().nullable(),
  unit: z.enum(ITEM_UNITS).nullable(),
  unitQty: z.number().nullable(),
  categorySlug: z.string(),
  imageUrl: z.string().nullable(),
  source: z.enum(['seed', 'import', 'open_barcode', 'ops']),
});
export const toMasterDto = (m: MasterProductRecord) => ({
  id: m.id,
  barcode: m.barcode,
  name: m.name,
  brand: m.brand,
  mrpPaise: m.mrpPaise,
  packLabel: m.packLabel,
  unit: m.unit,
  unitQty: m.unitQty,
  categorySlug: m.categorySlug,
  imageUrl: m.imageUrl,
  source: m.source,
});
export class BarcodeResultDto extends createZodDto(
  z.object({ source: z.enum(['master', 'open_barcode']), product: MasterProductSchema, existingItemId: z.uuid().nullable() }),
) {}
export class MasterListDto extends createZodDto(z.object({ items: z.array(MasterProductSchema) })) {}
export class MasterQueryDto extends createZodDto(z.object({ q: z.string().trim().min(2).max(60), limit: z.coerce.number().int().min(1).max(50).default(20) })) {}

export class EnrichBarcodeDto extends createZodDto(
  z.object({
    barcode: z.string().regex(/^\d{8,14}$/),
    name: z.string().trim().min(2).max(120),
    brand: z.string().trim().max(60).nullable().optional(),
    mrpPaise: paise.nullable().optional(),
    packLabel: z.string().trim().max(30).nullable().optional(),
    categorySlug: z.string().max(40),
    imageUrl: z.string().url().nullable().optional(),
  }),
) {}

export class BarcodeRequestListDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({ barcode: z.string(), scanCount: z.number().int(), lastMerchantId: z.string().nullable(), status: z.enum(['open', 'resolved']), createdAt: iso }),
    ),
  }),
) {}

// ── categories ──

export const CategorySchema = z.object({ slug: z.string(), name: z.string(), nameTe: z.string() });
export class CategoryListDto extends createZodDto(z.object({ items: z.array(CategorySchema) })) {}
export class CategoryQueryDto extends createZodDto(z.object({ type: z.enum(['retail', 'fashion', 'home_business', 'home_kitchen']) })) {}
export const toCategoryDto = (c: Category) => ({ slug: c.slug, name: c.name, nameTe: c.nameTe });

// ── import ──

export class ImportDto extends createZodDto(
  z.object({
    csv: z.string().min(1).max(2_000_000).describe('CSV text: name,name_te,category,size,unit,qty,price,mrp,stock,food_mark,allergens,barcode,description'),
    dryRun: z.boolean().default(false).describe('Validate only and return the report'),
  }),
) {}
export class ImportReportDto extends createZodDto(
  z.object({
    dryRun: z.boolean(),
    rows: z.number().int(),
    created: z.number().int(),
    held: z.number().int(),
    items: z.array(z.object({ lines: z.array(z.number().int()), name: z.string(), itemId: z.uuid().nullable() })),
    rejected: z.array(z.object({ line: z.number().int(), reasons: z.array(z.string()) })),
  }),
) {}
export const toImportDto = (r: ImportReport) => r;

// ── approvals ──

export class ApprovePendingDto extends createZodDto(
  z.object({ ids: z.union([z.array(z.uuid()).min(1).max(5000), z.literal('all')]).describe('Item ids, or "all"') }),
) {}
export class ApprovePendingResultDto extends createZodDto(z.object({ approved: z.number().int(), held: z.number().int() })) {}
export class ConfirmResultDto extends createZodDto(z.object({ confirmed: z.number().int() })) {}

// ── slots ──

export const SlotInputSchema = z.object({
  label: z.string().trim().max(30).nullable().optional(),
  days: z.array(day).min(1).max(7),
  start: hhmm,
  end: hhmm,
  cutoffMin: z.number().int().min(0).max(24 * 60).describe('Orders close this many minutes before the slot starts'),
  capacity: z.number().int().min(1).max(500).describe('Orders per slot per day'),
});
export class SlotsDto extends createZodDto(z.object({ slots: z.array(SlotInputSchema).max(12) })) {}
const SlotSchema = SlotInputSchema.extend({ id: z.uuid(), label: z.string().nullable() });
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
export class SlotListDto extends createZodDto(
  z.object({ slots: z.array(SlotSchema), occurrences: z.array(OccurrenceSchema), nextOpen: OccurrenceSchema.nullable() }),
) {}
export const toSlotDto = (s: SlotRecord) => ({ id: s.id, label: s.label, days: s.days, start: s.start, end: s.end, cutoffMin: s.cutoffMin, capacity: s.capacity });
export const toOccurrenceDto = (o: { slotId: string; date: string; start: string; end: string; startsAt: Date; cutoffAt: Date; capacity: number; booked: number; state: 'open' | 'closed' | 'full' }) => ({
  ...o,
  startsAt: o.startsAt.toISOString(),
  cutoffAt: o.cutoffAt.toISOString(),
});

// ── media ──

export class UploadRequestDto extends createZodDto(
  z.object({ purpose: z.enum(['item', 'store']), contentType: z.enum(UPLOAD_TYPES) }),
) {}
export class UploadTicketDto extends createZodDto(
  z.object({
    media: MediaSchema,
    upload: z.object({ url: z.string(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: iso }),
  }),
) {}
export class MediaDto extends createZodDto(MediaSchema) {}
export class MediaListDto extends createZodDto(z.object({ items: z.array(MediaSchema.extend({ merchantId: z.uuid() })) })) {}
export class PhotosDto extends createZodDto(z.object({ mediaIds: z.array(z.uuid()).max(6) })) {}
export class ReviewMediaDto extends createZodDto(z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(200).optional() })) {}
export class ReviewItemDto extends createZodDto(z.object({ decision: z.enum(['release', 'reject']), note: z.string().trim().max(300).optional() })) {}

export class QaSummaryDto extends createZodDto(
  z.object({
    heldItems: z.number().int(),
    pendingMerchantApproval: z.number().int(),
    staleItems: z.number().int(),
    photosToReview: z.number().int(),
    barcodeRequests: z.number().int(),
  }),
) {}
export class OpsItemQueryDto extends createZodDto(
  ItemQuerySchema.extend({ merchantId: z.uuid().optional() }),
) {}
export class SweepResultDto extends createZodDto(z.object({ flagged: z.number().int() })) {}
