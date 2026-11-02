import { Injectable } from '@nestjs/common';
import { Prisma, type Item, type ItemVariant, type Media } from '@prisma/client';
import type { Day } from '../../common/hours';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import type {
  BarcodeRequestRecord,
  ItemRecord,
  ItemStatus,
  MasterProductRecord,
  MediaRecord,
  SlotInput,
  SlotRecord,
  StockState,
  VariantInput,
  VariantRecord,
} from './domain/catalogue';

export type NewItem = Omit<ItemRecord, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'staleSince' | 'variants'> & {
  variants: VariantInput[];
};
export type ItemPatch = Partial<Omit<ItemRecord, 'id' | 'merchantId' | 'createdAt' | 'createdBy' | 'variants'>>;
export type NewMaster = Omit<MasterProductRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type NewMedia = Omit<MediaRecord, 'id' | 'createdAt' | 'reviewedAt' | 'reviewedBy' | 'rejectReason' | 'variants'>;
export type MediaPatch = Partial<Pick<MediaRecord, 'status' | 'variants' | 'rejectReason' | 'reviewedBy' | 'reviewedAt'>>;

export interface ItemQuery {
  merchantId?: string | undefined;
  status?: ItemStatus[] | undefined;
  /** Case-insensitive match on name, Telugu name or brand. */
  q?: string | undefined;
  categorySlug?: string | undefined;
  staleOnly?: boolean | undefined;
  limit: number;
  offset?: number | undefined;
}

export interface CatalogueTx {
  lockItem(id: string): Promise<ItemRecord | null>;
  createItem(i: NewItem): Promise<ItemRecord>;
  /** `variants` (when given) replaces the set: entries with an existing id are updated, others inserted, missing ones deleted. */
  updateItem(id: string, patch: ItemPatch, variants?: VariantInput[]): Promise<ItemRecord>;
  setStock(itemId: string, variantId: string | null, stock: StockState, at: Date): Promise<ItemRecord>;
  /** Marks every live item of the merchant confirmed now (clears staleness); returns the ids touched. */
  confirmAll(merchantId: string, at: Date): Promise<string[]>;
  flagStale(ids: string[], at: Date): Promise<void>;
  upsertMaster(m: NewMaster): Promise<MasterProductRecord>;
  recordBarcodeRequest(barcode: string, merchantId: string | null): Promise<BarcodeRequestRecord>;
  resolveBarcodeRequest(barcode: string, masterProductId: string, by: string | null, at: Date): Promise<void>;
  replaceSlots(merchantId: string, slots: SlotInput[]): Promise<SlotRecord[]>;
  createMedia(m: NewMedia): Promise<MediaRecord>;
  updateMedia(id: string, patch: MediaPatch): Promise<MediaRecord>;
  appendEvent<P>(e: NewEvent<P>): Promise<void>;
  appendAudit(a: AuditEntry): Promise<void>;
}

/** Storage port for the catalogue (merchant-catalogue owns items, variants, master products, slots, media). */
export abstract class CatalogueRepository {
  abstract transaction<T>(fn: (tx: CatalogueTx) => Promise<T>): Promise<T>;
  abstract getItem(id: string): Promise<ItemRecord | null>;
  /** Not deleted; ordered by category, then name. */
  abstract listItems(q: ItemQuery): Promise<ItemRecord[]>;
  abstract countItems(q: Omit<ItemQuery, 'limit' | 'offset'>): Promise<number>;
  /** Active, not stale, not deleted items whose confirmation is older than `before` (oldest first). */
  abstract staleCandidates(microMarketId: string | null, before: Date, limit: number): Promise<Array<{ id: string; merchantId: string; confirmedAt: Date }>>;
  abstract masterByBarcode(codes: string[]): Promise<MasterProductRecord | null>;
  abstract getMaster(id: string): Promise<MasterProductRecord | null>;
  abstract searchMaster(q: string, limit: number): Promise<MasterProductRecord[]>;
  abstract countMaster(): Promise<number>;
  abstract barcodeRequests(status: 'open' | 'resolved', limit: number): Promise<BarcodeRequestRecord[]>;
  abstract slots(merchantId: string): Promise<SlotRecord[]>;
  abstract getMedia(id: string): Promise<MediaRecord | null>;
  abstract mediaByIds(ids: string[]): Promise<MediaRecord[]>;
  /** Oldest first. */
  abstract listMedia(q: { status?: MediaRecord['status'] | undefined; merchantId?: string | undefined; limit: number }): Promise<MediaRecord[]>;
}

// ───────────── Prisma ─────────────

type ItemRow = Item & { variants: ItemVariant[] };

const toVariant = (v: ItemVariant): VariantRecord => ({
  id: v.id,
  itemId: v.itemId,
  label: v.label,
  unit: v.unit,
  unitQty: v.unitQty,
  pricePaise: v.pricePaise,
  mrpPaise: v.mrpPaise,
  stock: v.stock,
  position: v.position,
});

const toItem = (r: ItemRow): ItemRecord => ({
  id: r.id,
  merchantId: r.merchantId,
  microMarketId: r.microMarketId,
  masterProductId: r.masterProductId,
  name: r.name,
  nameTe: r.nameTe,
  description: r.description,
  brand: r.brand,
  categorySlug: r.categorySlug,
  foodMark: r.foodMark,
  allergens: r.allergens,
  madeToOrder: r.madeToOrder,
  leadTimeMin: r.leadTimeMin,
  maxPerOrder: r.maxPerOrder,
  availableDays: r.availableDays as Day[],
  dailyCapacity: r.dailyCapacity,
  specialOn: r.specialOn,
  status: r.status,
  reviewReason: r.reviewReason,
  source: r.source,
  imageIds: r.imageIds,
  confirmedAt: r.confirmedAt,
  staleSince: r.staleSince,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  deletedAt: r.deletedAt,
  variants: [...r.variants].sort((a, b) => a.position - b.position).map(toVariant),
});

const toMedia = (m: Media): MediaRecord => ({
  ...m,
  purpose: m.purpose as MediaRecord['purpose'],
  variants: (m.variants as MediaRecord['variants']) ?? null,
});

const toSlot = (s: { id: string; merchantId: string; label: string | null; days: string[]; start: string; end: string; cutoffMin: number; capacity: number; position: number }): SlotRecord => ({
  id: s.id,
  merchantId: s.merchantId,
  label: s.label,
  days: s.days as Day[],
  start: s.start,
  end: s.end,
  cutoffMin: s.cutoffMin,
  capacity: s.capacity,
  position: s.position,
});

const include = { variants: { orderBy: { position: 'asc' as const } } };

function itemWhere(q: Omit<ItemQuery, 'limit' | 'offset'>): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = { deletedAt: null };
  if (q.merchantId) where.merchantId = q.merchantId;
  if (q.status?.length) where.status = { in: q.status };
  if (q.categorySlug) where.categorySlug = q.categorySlug;
  if (q.staleOnly) where.staleSince = { not: null };
  if (q.q?.trim()) {
    const contains = q.q.trim();
    where.OR = [
      { name: { contains, mode: 'insensitive' } },
      { nameTe: { contains, mode: 'insensitive' } },
      { brand: { contains, mode: 'insensitive' } },
    ];
  }
  return where;
}

const variantData = (v: VariantInput, position: number) => ({
  label: v.label.trim(),
  unit: v.unit,
  unitQty: v.unitQty,
  pricePaise: v.pricePaise,
  mrpPaise: v.mrpPaise ?? null,
  stock: v.stock ?? 'in',
  position,
});

class PrismaCatalogueTx implements CatalogueTx {
  constructor(private readonly tx: Tx) {}

  async lockItem(id: string): Promise<ItemRecord | null> {
    const rows = await this.tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM items WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) return null;
    return toItem(await this.tx.item.findUniqueOrThrow({ where: { id }, include }));
  }

  async createItem(i: NewItem): Promise<ItemRecord> {
    const { variants, ...rest } = i;
    const r = await this.tx.item.create({
      data: { ...rest, variants: { create: variants.map(variantData) } },
      include,
    });
    return toItem(r);
  }

  async updateItem(id: string, patch: ItemPatch, variants?: VariantInput[]): Promise<ItemRecord> {
    await this.tx.item.update({ where: { id }, data: { ...patch, updatedAt: new Date() } });
    if (variants) {
      const keep = variants.filter((v) => v.id).map((v) => v.id!);
      await this.tx.itemVariant.deleteMany({ where: { itemId: id, id: { notIn: keep } } });
      for (const [i, v] of variants.entries()) {
        if (v.id) await this.tx.itemVariant.updateMany({ where: { id: v.id, itemId: id }, data: variantData(v, i) });
        else await this.tx.itemVariant.create({ data: { ...variantData(v, i), itemId: id } });
      }
    }
    return toItem(await this.tx.item.findUniqueOrThrow({ where: { id }, include }));
  }

  async setStock(itemId: string, variantId: string | null, stock: StockState, at: Date): Promise<ItemRecord> {
    await this.tx.itemVariant.updateMany({ where: { itemId, ...(variantId ? { id: variantId } : {}) }, data: { stock } });
    await this.tx.item.update({ where: { id: itemId }, data: { confirmedAt: at, staleSince: null, updatedAt: at } });
    return toItem(await this.tx.item.findUniqueOrThrow({ where: { id: itemId }, include }));
  }

  async confirmAll(merchantId: string, at: Date): Promise<string[]> {
    const rows = await this.tx.$queryRaw<{ id: string }[]>`
      UPDATE items SET confirmed_at = ${at}, stale_since = NULL, updated_at = ${at}
      WHERE merchant_id = ${merchantId}::uuid AND deleted_at IS NULL AND status IN ('active', 'in_review')
      RETURNING id::text`;
    return rows.map((r) => r.id);
  }

  async flagStale(ids: string[], at: Date): Promise<void> {
    if (ids.length) await this.tx.item.updateMany({ where: { id: { in: ids }, staleSince: null }, data: { staleSince: at } });
  }

  async upsertMaster(m: NewMaster): Promise<MasterProductRecord> {
    return this.tx.masterProduct.upsert({ where: { barcode: m.barcode }, create: m, update: m });
  }

  async recordBarcodeRequest(barcode: string, merchantId: string | null): Promise<BarcodeRequestRecord> {
    const r = await this.tx.barcodeRequest.upsert({
      where: { barcode },
      create: { barcode, lastMerchantId: merchantId },
      update: { scanCount: { increment: 1 }, lastMerchantId: merchantId },
    });
    return { ...r, status: r.status as BarcodeRequestRecord['status'] };
  }

  async resolveBarcodeRequest(barcode: string, masterProductId: string, by: string | null, at: Date): Promise<void> {
    await this.tx.barcodeRequest.updateMany({
      where: { barcode, status: 'open' },
      data: { status: 'resolved', masterProductId, resolvedBy: by, resolvedAt: at },
    });
  }

  async replaceSlots(merchantId: string, slots: SlotInput[]): Promise<SlotRecord[]> {
    await this.tx.kitchenSlot.deleteMany({ where: { merchantId } });
    await this.tx.kitchenSlot.createMany({
      data: slots.map((s, position) => ({ merchantId, label: s.label ?? null, days: s.days, start: s.start, end: s.end, cutoffMin: s.cutoffMin, capacity: s.capacity, position })),
    });
    return (await this.tx.kitchenSlot.findMany({ where: { merchantId }, orderBy: { position: 'asc' } })).map(toSlot);
  }

  async createMedia(m: NewMedia): Promise<MediaRecord> {
    return toMedia(await this.tx.media.create({ data: m }));
  }

  async updateMedia(id: string, patch: MediaPatch): Promise<MediaRecord> {
    const { variants, ...rest } = patch;
    const data: Prisma.MediaUpdateInput = { ...rest };
    if (variants !== undefined) data.variants = variants === null ? Prisma.JsonNull : (variants as unknown as Prisma.InputJsonValue);
    return toMedia(await this.tx.media.update({ where: { id }, data }));
  }

  async appendEvent<P>(e: NewEvent<P>): Promise<void> {
    await appendToOutbox(this.tx, e);
  }

  async appendAudit(a: AuditEntry): Promise<void> {
    await appendAudit(this.tx, a);
  }
}

@Injectable()
export class PrismaCatalogueRepository extends CatalogueRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  transaction<T>(fn: (tx: CatalogueTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaCatalogueTx(tx)), { timeout: 30_000 });
  }

  async getItem(id: string): Promise<ItemRecord | null> {
    const r = await this.prisma.item.findUnique({ where: { id }, include });
    return r ? toItem(r) : null;
  }

  async listItems(q: ItemQuery): Promise<ItemRecord[]> {
    const rows = await this.prisma.item.findMany({
      where: itemWhere(q),
      include,
      orderBy: [{ categorySlug: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: q.limit,
      skip: q.offset ?? 0,
    });
    return rows.map(toItem);
  }

  countItems(q: Omit<ItemQuery, 'limit' | 'offset'>): Promise<number> {
    return this.prisma.item.count({ where: itemWhere(q) });
  }

  async staleCandidates(microMarketId: string | null, before: Date, limit: number) {
    return this.prisma.item.findMany({
      where: { microMarketId, status: 'active', deletedAt: null, staleSince: null, confirmedAt: { lt: before } },
      select: { id: true, merchantId: true, confirmedAt: true },
      orderBy: { confirmedAt: 'asc' },
      take: limit,
    });
  }

  masterByBarcode(codes: string[]): Promise<MasterProductRecord | null> {
    return this.prisma.masterProduct.findFirst({ where: { barcode: { in: codes } } });
  }

  getMaster(id: string): Promise<MasterProductRecord | null> {
    return this.prisma.masterProduct.findUnique({ where: { id } });
  }

  searchMaster(q: string, limit: number): Promise<MasterProductRecord[]> {
    const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    return this.prisma.masterProduct.findMany({
      where: { AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' as const } }, { brand: { contains: w, mode: 'insensitive' as const } }] })) },
      orderBy: [{ name: 'asc' }, { barcode: 'asc' }],
      take: limit,
    });
  }

  countMaster(): Promise<number> {
    return this.prisma.masterProduct.count();
  }

  async barcodeRequests(status: 'open' | 'resolved', limit: number): Promise<BarcodeRequestRecord[]> {
    const rows = await this.prisma.barcodeRequest.findMany({ where: { status }, orderBy: [{ scanCount: 'desc' }, { createdAt: 'asc' }], take: limit });
    return rows.map((r) => ({ ...r, status: r.status as BarcodeRequestRecord['status'] }));
  }

  async slots(merchantId: string): Promise<SlotRecord[]> {
    return (await this.prisma.kitchenSlot.findMany({ where: { merchantId }, orderBy: { position: 'asc' } })).map(toSlot);
  }

  async getMedia(id: string): Promise<MediaRecord | null> {
    const m = await this.prisma.media.findUnique({ where: { id } });
    return m ? toMedia(m) : null;
  }

  async mediaByIds(ids: string[]): Promise<MediaRecord[]> {
    if (!ids.length) return [];
    return (await this.prisma.media.findMany({ where: { id: { in: ids } } })).map(toMedia);
  }

  async listMedia(q: { status?: MediaRecord['status'] | undefined; merchantId?: string | undefined; limit: number }): Promise<MediaRecord[]> {
    const rows = await this.prisma.media.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.merchantId ? { merchantId: q.merchantId } : {}) },
      orderBy: { createdAt: 'asc' },
      take: q.limit,
    });
    return rows.map(toMedia);
  }
}
