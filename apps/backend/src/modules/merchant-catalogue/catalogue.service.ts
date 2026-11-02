import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import type { Day } from '../../common/hours';
import { BarcodeLookupProvider, type BarcodeHit } from '../../infra/providers/barcode/barcode.provider';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { TrustSafetyService } from '../trust-safety/trust-safety.service';
import { CatalogueRepository, type CatalogueTx, type ItemPatch, type ItemQuery, type NewItem } from './catalogue.repository';
import {
  type FoodMark,
  type ItemRecord,
  type ItemSource,
  type ItemStatus,
  itemProblems,
  itemStock,
  type MasterProductRecord,
  MAX_IMAGES,
  type SlotInput,
  slotOccurrences,
  slotProblems,
  type SlotRecord,
  type StockState,
  type VariantInput,
} from './domain/catalogue';
import { gtinAliases, isValidGtin } from './domain/gtin';
import { parseItemImport, type RejectedRow } from './domain/import';
import type { MerchantRecord } from './domain/merchant';
import { categoriesFor, categoryBySlug } from './domain/taxonomy';
import { MediaService, type MediaView } from './media.service';
import { MerchantsService } from './merchants.service';

export interface ItemInput {
  masterProductId?: string | null | undefined;
  name?: string | undefined;
  nameTe?: string | null | undefined;
  description?: string | null | undefined;
  brand?: string | null | undefined;
  categorySlug?: string | undefined;
  foodMark?: FoodMark | null | undefined;
  allergens?: string[] | undefined;
  madeToOrder?: boolean | undefined;
  leadTimeMin?: number | null | undefined;
  maxPerOrder?: number | null | undefined;
  availableDays?: Day[] | undefined;
  dailyCapacity?: number | null | undefined;
  specialOn?: string | null | undefined;
  imageIds?: string[] | undefined;
  variants?: VariantInput[] | undefined;
  /** Merchant hides/shows an item without deleting it. */
  hidden?: boolean | undefined;
}

export interface ItemView {
  item: ItemRecord;
  images: MediaView[];
  /** Image consumers see: first approved photo, else the master catalogue image. */
  imageUrl: string | null;
  stock: StockState;
  stale: boolean;
}

export interface Actor {
  userId: string;
  requestId?: string | null;
}

export interface ImportReport {
  dryRun: boolean;
  rows: number;
  created: number;
  held: number;
  items: Array<{ lines: number[]; name: string; itemId: string | null }>;
  rejected: RejectedRow[];
}

export interface BarcodeResult {
  source: 'master' | 'open_barcode';
  product: MasterProductRecord;
  /** The merchant already sells this product (scan again = edit). */
  existingItemId: string | null;
}

const MAX_PAGE = 200;

/** Map Open Food Facts category tags to the platform taxonomy (best effort; ops can recategorise). */
function categoryFromTags(tags: string[]): string {
  const t = tags.join(' ');
  const rules: Array<[RegExp, string]> = [
    [/milk|dairy|curd|yogurt|paneer|cheese|butter/, 'dairy'],
    [/noodle|breakfast|cereal|oats|instant/, 'breakfast'],
    [/biscuit|cookie|chocolate|confection/, 'biscuits'],
    [/snack|chips|namkeen|peanut/, 'snacks'],
    [/tea|coffee|beverage|drink|juice/, 'beverages'],
    [/oil|ghee/, 'oils_ghee'],
    [/spice|masala|condiment/, 'masala'],
    [/rice|flour|atta|lentil|dal|pulse|cereal/, 'staples'],
    [/soap|shampoo|toothpaste|cosmetic|hygiene/, 'personal_care'],
    [/detergent|clean/, 'household'],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? 'other_retail';
}

/** "500 g" → { unit: g, qty: 500 }. */
export function parsePack(label: string | null): { unit: NewItem['variants'][number]['unit']; qty: number } | null {
  const m = label?.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ltr|ml|pc|pcs|pack)$/);
  if (!m) return null;
  const unit = ({ gm: 'g', gms: 'g', ltr: 'l', pcs: 'pc' } as Record<string, string>)[m[2]!] ?? m[2]!;
  return { unit: unit as NewItem['variants'][number]['unit'], qty: Number(m[1]) };
}

/**
 * merchant-catalogue, catalogue side (M2): items and variants with price ≤ MRP and tri-state stock
 * (FR-CAT-1/2/6), master catalogue + barcode resolution with the open-barcode fallback and the ops
 * enrichment queue, bulk CSV import (FR-CAT-4), assisted entry by ops with merchant approval
 * (FR-CAT-3), home-kitchen menus and slots (FR-CAT-5), prohibited-item holds (FR-CAT-7) and
 * catalogue staleness (tech plan 7.6). Events out: item.*, merchant.catalogue_confirmed,
 * merchant.slots_updated.
 */
@Injectable()
export class CatalogueService {
  private readonly logger = new Logger(CatalogueService.name);

  constructor(
    private readonly repo: CatalogueRepository,
    private readonly merchants: MerchantsService,
    private readonly media: MediaService,
    private readonly markets: MicroMarketsService,
    private readonly safety: TrustSafetyService,
    private readonly barcodes: BarcodeLookupProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  categories(type: MerchantRecord['type']) {
    return categoriesFor(type);
  }

  // ───────────── reads ─────────────

  async list(merchant: MerchantRecord, q: Omit<ItemQuery, 'merchantId' | 'limit'> & { limit?: number | undefined }): Promise<{ items: ItemView[]; total: number }> {
    const query = { ...q, merchantId: merchant.id };
    const [rows, total] = await Promise.all([this.repo.listItems({ ...query, limit: Math.min(q.limit ?? 50, MAX_PAGE) }), this.repo.countItems(query)]);
    return { items: await this.views(rows), total };
  }

  async get(merchant: MerchantRecord, id: string): Promise<ItemView> {
    return this.view(await this.ownedItem(merchant, id));
  }

  /** Ops: any merchant's items (catalogue QA, assisted entry). */
  async listForOps(q: ItemQuery): Promise<{ items: ItemView[]; total: number }> {
    const { limit, offset, ...rest } = q;
    const [rows, total] = await Promise.all([this.repo.listItems({ ...rest, limit: Math.min(limit, MAX_PAGE), offset }), this.repo.countItems(rest)]);
    return { items: await this.views(rows), total };
  }

  // ───────────── barcode + master catalogue ─────────────

  /**
   * Scan → master product (FR-CAT-1). Misses fall back to the open-barcode provider (stored as a
   * master product so the next scan is instant); a miss there goes to the ops enrichment queue and
   * the app opens the create-SKU form.
   */
  async resolveBarcode(merchant: MerchantRecord | null, raw: string): Promise<BarcodeResult> {
    const code = raw.replace(/\s/g, '');
    if (!isValidGtin(code)) throw new DomainError('VALIDATION_FAILED', 'That does not look like a product barcode. Scan again or type it in.', { barcode: code });
    const existing = async (p: MasterProductRecord) =>
      merchant ? ((await this.repo.listItems({ merchantId: merchant.id, limit: 500 })).find((i) => i.masterProductId === p.id)?.id ?? null) : null;

    const found = await this.repo.masterByBarcode(gtinAliases(code));
    if (found) return { source: 'master', product: found, existingItemId: await existing(found) };

    const hit = await this.barcodes.lookup(code);
    if (hit) {
      const product = await this.repo.transaction((tx) => tx.upsertMaster(this.masterFromHit(hit)));
      return { source: 'open_barcode', product, existingItemId: null };
    }
    await this.repo.transaction((tx) => tx.recordBarcodeRequest(code, merchant?.id ?? null));
    throw new DomainError('BARCODE_UNKNOWN', 'We do not know this product yet. Add it yourself — our team will also add it to the catalogue.', { barcode: code });
  }

  private masterFromHit(hit: BarcodeHit) {
    const pack = parsePack(hit.quantity);
    return {
      barcode: hit.barcode,
      name: hit.name,
      brand: hit.brand,
      mrpPaise: null,
      packLabel: hit.quantity,
      unit: pack?.unit ?? null,
      unitQty: pack?.qty ?? null,
      categorySlug: categoryFromTags(hit.categories),
      imageUrl: hit.imageUrl,
      source: 'open_barcode' as const,
    };
  }

  searchMaster(q: string, limit = 20): Promise<MasterProductRecord[]> {
    if (q.trim().length < 2) return Promise.resolve([]);
    return this.repo.searchMaster(q, Math.min(limit, 50));
  }

  barcodeRequests(status: 'open' | 'resolved' = 'open') {
    return this.repo.barcodeRequests(status, 200);
  }

  /** Ops enrichment: add the product for a queued barcode; later scans resolve to it. */
  async enrichBarcode(
    input: { barcode: string; name: string; brand?: string | null | undefined; mrpPaise?: number | null | undefined; packLabel?: string | null | undefined; categorySlug: string; imageUrl?: string | null | undefined },
    actor: Actor,
  ): Promise<MasterProductRecord> {
    if (!isValidGtin(input.barcode)) throw new DomainError('VALIDATION_FAILED', 'Barcode check digit is wrong');
    if (!categoryBySlug(input.categorySlug)) throw new DomainError('VALIDATION_FAILED', 'Unknown category');
    const pack = parsePack(input.packLabel ?? null);
    return this.repo.transaction(async (tx) => {
      const p = await tx.upsertMaster({
        barcode: input.barcode,
        name: input.name.trim(),
        brand: input.brand?.trim() || null,
        mrpPaise: input.mrpPaise ?? null,
        packLabel: input.packLabel?.trim() || null,
        unit: pack?.unit ?? null,
        unitQty: pack?.qty ?? null,
        categorySlug: input.categorySlug,
        imageUrl: input.imageUrl ?? null,
        source: 'ops',
      });
      await tx.resolveBarcodeRequest(input.barcode, p.id, actor.userId, this.clock());
      await tx.appendAudit({ entity: 'master_product', entityId: p.id, action: 'enriched', actorId: actor.userId, after: { barcode: p.barcode, name: p.name }, requestId: actor.requestId ?? null });
      return p;
    });
  }

  // ───────────── merchant writes ─────────────

  async create(merchant: MerchantRecord, actor: Actor, input: ItemInput, source: ItemSource = 'merchant'): Promise<ItemView> {
    const item = await this.repo.transaction((tx) => this.insert(tx, merchant, actor, input, source));
    return this.view(item);
  }

  private async insert(tx: CatalogueTx, merchant: MerchantRecord, actor: Actor, input: ItemInput, source: ItemSource): Promise<ItemRecord> {
    const master = input.masterProductId ? await this.repo.getMaster(input.masterProductId) : null;
    if (input.masterProductId && !master) throw new DomainError('NOT_FOUND', 'Product not found in the master catalogue');
    const variants: VariantInput[] = (input.variants ?? []).map((v) => ({ ...v, mrpPaise: v.mrpPaise ?? master?.mrpPaise ?? null }));
    const draft = {
      name: input.name ?? (master ? [master.brand, master.name, master.packLabel].filter(Boolean).join(' ') : ''),
      categorySlug: input.categorySlug ?? master?.categorySlug ?? '',
      foodMark: input.foodMark ?? null,
      allergens: input.allergens ?? [],
      madeToOrder: input.madeToOrder ?? false,
      leadTimeMin: input.leadTimeMin ?? null,
      variants,
      packagedMrpPaise: master?.mrpPaise ?? null,
    };
    this.check(merchant, draft, input);
    if (input.imageIds?.length) await this.media.assertUsable(merchant.id, input.imageIds, 'item');
    const screen = this.safety.screenItem({ name: draft.name, nameTe: input.nameTe, description: input.description, brand: input.brand ?? master?.brand });
    const assisted = source === 'ops';
    const status: ItemStatus = assisted ? 'pending_merchant' : screen.held ? 'in_review' : 'active';
    const now = this.clock();
    const item = await tx.createItem({
      merchantId: merchant.id,
      microMarketId: merchant.microMarketId,
      masterProductId: master?.id ?? null,
      name: draft.name.trim(),
      nameTe: input.nameTe?.trim() || null,
      description: input.description?.trim() || null,
      brand: input.brand?.trim() || master?.brand || null,
      categorySlug: draft.categorySlug,
      foodMark: draft.foodMark,
      allergens: [...new Set(draft.allergens)],
      madeToOrder: draft.madeToOrder,
      leadTimeMin: draft.madeToOrder ? draft.leadTimeMin : (input.leadTimeMin ?? null),
      maxPerOrder: input.maxPerOrder ?? null,
      availableDays: input.availableDays ?? [],
      dailyCapacity: input.dailyCapacity ?? null,
      specialOn: input.specialOn ?? null,
      status,
      reviewReason: screen.reason,
      source: master && source === 'merchant' ? 'master' : source,
      imageIds: input.imageIds ?? [],
      confirmedAt: now,
      createdBy: actor.userId,
      variants,
    });
    await tx.appendEvent({
      type: 'item.created',
      aggregate: { type: 'item', id: item.id },
      microMarketId: merchant.microMarketId,
      actor: { type: assisted ? 'ops' : 'user', id: actor.userId },
      payload: { item_id: item.id, merchant_id: merchant.id, source: item.source, status, master_product_id: item.masterProductId, held_for: screen.codes },
    });
    if (assisted)
      await tx.appendAudit({
        entity: 'item',
        entityId: item.id,
        action: 'assisted_created',
        actorId: actor.userId,
        microMarketId: merchant.microMarketId,
        after: { merchantId: merchant.id, name: item.name, variants: item.variants.map((v) => ({ label: v.label, pricePaise: v.pricePaise })) },
        requestId: actor.requestId ?? null,
      });
    return item;
  }

  private check(merchant: MerchantRecord, draft: Parameters<typeof itemProblems>[1], input: ItemInput): void {
    const problems = itemProblems(merchant, draft);
    if (input.imageIds && input.imageIds.length > MAX_IMAGES) problems.push({ field: 'imageIds', message: `Up to ${MAX_IMAGES} photos` });
    if (merchant.type !== 'home_kitchen' && (input.dailyCapacity != null || input.specialOn != null || input.availableDays?.length))
      problems.push({ field: 'availableDays', message: 'Menus and daily capacity are for home kitchens' });
    if (problems.length) throw new DomainError('VALIDATION_FAILED', problems[0]!.message, { problems });
  }

  async update(merchant: MerchantRecord, actor: Actor, id: string, input: ItemInput, opts: { ops?: boolean } = {}): Promise<ItemView> {
    const current = await this.ownedItem(merchant, id);
    const master = current.masterProductId ? await this.repo.getMaster(current.masterProductId) : null;
    const variants = input.variants?.map((v) => ({ ...v, mrpPaise: v.mrpPaise ?? master?.mrpPaise ?? null }));
    const next = {
      name: input.name ?? current.name,
      categorySlug: input.categorySlug ?? current.categorySlug,
      foodMark: input.foodMark !== undefined ? input.foodMark : current.foodMark,
      allergens: input.allergens ?? current.allergens,
      madeToOrder: input.madeToOrder ?? current.madeToOrder,
      leadTimeMin: input.leadTimeMin !== undefined ? input.leadTimeMin : current.leadTimeMin,
      variants: variants ?? current.variants,
      packagedMrpPaise: master?.mrpPaise ?? null,
    };
    this.check(merchant, next, { ...input, dailyCapacity: input.dailyCapacity, specialOn: input.specialOn });
    if (input.imageIds) await this.media.assertUsable(merchant.id, input.imageIds, 'item');

    const patch: ItemPatch = {};
    for (const k of ['name', 'categorySlug', 'foodMark', 'allergens', 'madeToOrder', 'leadTimeMin', 'maxPerOrder', 'availableDays', 'dailyCapacity', 'specialOn', 'imageIds'] as const)
      if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    for (const k of ['nameTe', 'description', 'brand'] as const) if (input[k] !== undefined) patch[k] = input[k]?.trim() || null;
    if (patch.name) patch.name = patch.name.trim();

    const textChanged = ['name', 'nameTe', 'description', 'brand'].some((k) => k in patch);
    if (textChanged && current.status !== 'pending_merchant') {
      const screen = this.safety.screenItem({ name: next.name, nameTe: patch.nameTe ?? current.nameTe, description: patch.description ?? current.description, brand: patch.brand ?? current.brand });
      if (screen.held) Object.assign(patch, { status: 'in_review', reviewReason: screen.reason });
    }
    if (input.hidden !== undefined && current.status !== 'pending_merchant' && patch.status !== 'in_review') {
      if (input.hidden && current.status === 'active') patch.status = 'hidden';
      if (!input.hidden && current.status === 'hidden') patch.status = 'active';
    }
    const now = this.clock();
    if (variants) Object.assign(patch, { confirmedAt: now, staleSince: null });

    const priceChanges = variants
      ? variants.flatMap((v) => {
          const old = current.variants.find((o) => o.id === v.id);
          return old && old.pricePaise !== v.pricePaise ? [{ variantId: old.id, label: old.label, from: old.pricePaise, to: v.pricePaise }] : [];
        })
      : [];
    const updated = await this.repo.transaction(async (tx) => {
      const r = await tx.updateItem(id, patch, variants);
      const actorRef = { type: opts.ops ? ('ops' as const) : ('user' as const), id: actor.userId };
      await tx.appendEvent({
        type: 'item.updated',
        aggregate: { type: 'item', id },
        microMarketId: merchant.microMarketId,
        actor: actorRef,
        payload: { item_id: id, merchant_id: merchant.id, fields: [...Object.keys(patch), ...(variants ? ['variants'] : [])], status: r.status },
      });
      for (const c of priceChanges) {
        await tx.appendEvent({
          type: 'item.price_changed',
          aggregate: { type: 'item', id },
          microMarketId: merchant.microMarketId,
          actor: actorRef,
          payload: { item_id: id, merchant_id: merchant.id, variant_id: c.variantId, from_paise: c.from, to_paise: c.to },
        });
        // FR-CAT-6: price changes are logged and viewable in the ops audit log.
        await tx.appendAudit({
          entity: 'item',
          entityId: id,
          action: 'price_changed',
          actorId: actor.userId,
          microMarketId: merchant.microMarketId,
          before: { variant: c.label, pricePaise: c.from },
          after: { variant: c.label, pricePaise: c.to },
          requestId: actor.requestId ?? null,
        });
      }
      if (opts.ops)
        await tx.appendAudit({ entity: 'item', entityId: id, action: 'assisted_updated', actorId: actor.userId, microMarketId: merchant.microMarketId, after: { fields: Object.keys(patch) }, requestId: actor.requestId ?? null });
      return r;
    });
    return this.view(updated);
  }

  /** One-tap stock toggle (whole item or one variant). Also confirms the item (clears staleness). */
  async setStock(merchant: MerchantRecord, actor: Actor, id: string, stock: StockState, variantId?: string | null): Promise<ItemView> {
    const current = await this.ownedItem(merchant, id);
    if (variantId && !current.variants.some((v) => v.id === variantId)) throw new DomainError('NOT_FOUND', 'Size not found');
    const updated = await this.repo.transaction(async (tx) => {
      const r = await tx.setStock(id, variantId ?? null, stock, this.clock());
      await tx.appendEvent({
        type: 'item.stock_changed',
        aggregate: { type: 'item', id },
        microMarketId: merchant.microMarketId,
        actor: { type: 'user', id: actor.userId },
        payload: { item_id: id, merchant_id: merchant.id, variant_id: variantId ?? null, stock, item_stock: itemStock(r.variants) },
      });
      return r;
    });
    return this.view(updated);
  }

  /** Daily availability check ("everything is as listed"): confirms every item, clearing stale flags. */
  async confirmAll(merchant: MerchantRecord, actor: Actor): Promise<{ confirmed: number }> {
    const ids = await this.repo.transaction(async (tx) => {
      const touched = await tx.confirmAll(merchant.id, this.clock());
      await tx.appendEvent({
        type: 'merchant.catalogue_confirmed',
        aggregate: { type: 'merchant', id: merchant.id },
        microMarketId: merchant.microMarketId,
        actor: { type: 'user', id: actor.userId },
        payload: { merchant_id: merchant.id, items: touched.length },
      });
      return touched;
    });
    return { confirmed: ids.length };
  }

  async remove(merchant: MerchantRecord, actor: Actor, id: string): Promise<void> {
    await this.ownedItem(merchant, id);
    await this.repo.transaction(async (tx) => {
      await tx.updateItem(id, { deletedAt: this.clock() });
      await tx.appendEvent({
        type: 'item.deleted',
        aggregate: { type: 'item', id },
        microMarketId: merchant.microMarketId,
        actor: { type: 'user', id: actor.userId },
        payload: { item_id: id, merchant_id: merchant.id },
      });
    });
  }

  /** FR-CAT-3: the merchant approves items ops built for them (item by item, or all). */
  async approvePending(merchant: MerchantRecord, actor: Actor, ids: string[] | 'all'): Promise<{ approved: number; held: number }> {
    const pending = await this.repo.listItems({ merchantId: merchant.id, status: ['pending_merchant'], limit: 5000 });
    const chosen = ids === 'all' ? pending : pending.filter((i) => ids.includes(i.id));
    if (ids !== 'all' && chosen.length !== ids.length) throw new DomainError('NOT_FOUND', 'Some items are not waiting for your approval');
    let held = 0;
    await this.repo.transaction(async (tx) => {
      for (const i of chosen) {
        const status: ItemStatus = i.reviewReason ? 'in_review' : 'active';
        if (status === 'in_review') held++;
        await tx.updateItem(i.id, { status, confirmedAt: this.clock(), staleSince: null });
        await tx.appendEvent({
          type: 'item.approved',
          aggregate: { type: 'item', id: i.id },
          microMarketId: merchant.microMarketId,
          actor: { type: 'user', id: actor.userId },
          payload: { item_id: i.id, merchant_id: merchant.id, status },
        });
      }
    });
    return { approved: chosen.length - held, held };
  }

  async rejectPending(merchant: MerchantRecord, actor: Actor, id: string): Promise<void> {
    const i = await this.ownedItem(merchant, id);
    if (i.status !== 'pending_merchant') throw new DomainError('INVALID_STATE', 'This item is not waiting for your approval');
    await this.remove(merchant, actor, id);
  }

  // ───────────── bulk import (FR-CAT-4) ─────────────

  async importCsv(merchant: MerchantRecord, actor: Actor, csv: string, opts: { dryRun: boolean; source: ItemSource }): Promise<ImportReport> {
    const parsed = parseItemImport(csv);
    if (parsed.headerProblems.length) throw new DomainError('VALIDATION_FAILED', parsed.headerProblems[0]!, { problems: parsed.headerProblems });
    const rejected = [...parsed.rejected];
    const report: ImportReport = { dryRun: opts.dryRun, rows: parsed.items.reduce((n, i) => n + i.lines.length, 0) + parsed.rejected.length, created: 0, held: 0, items: [], rejected };

    const accepted: Array<{ lines: number[]; input: ItemInput }> = [];
    for (const it of parsed.items) {
      const master = it.barcode ? await this.repo.masterByBarcode(gtinAliases(it.barcode)) : null;
      const input: ItemInput = {
        masterProductId: master?.id ?? null,
        name: it.name,
        nameTe: it.nameTe,
        description: it.description,
        categorySlug: it.categorySlug,
        foodMark: it.foodMark,
        allergens: it.allergens,
        variants: it.variants.map((v) => ({ ...v, mrpPaise: v.mrpPaise ?? master?.mrpPaise ?? null })),
      };
      const problems = itemProblems(merchant, {
        name: it.name,
        categorySlug: it.categorySlug,
        foodMark: it.foodMark,
        allergens: it.allergens,
        madeToOrder: false,
        leadTimeMin: null,
        variants: input.variants!,
        packagedMrpPaise: master?.mrpPaise ?? null,
      });
      if (problems.length) rejected.push({ line: it.lines[0]!, reasons: problems.map((p) => p.message) });
      else accepted.push({ lines: it.lines, input });
    }
    rejected.sort((a, b) => a.line - b.line);
    if (opts.dryRun) {
      report.items = accepted.map((a) => ({ lines: a.lines, name: a.input.name!, itemId: null }));
      return report;
    }
    await this.repo.transaction(async (tx) => {
      for (const a of accepted) {
        const item = await this.insert(tx, merchant, actor, a.input, opts.source);
        report.items.push({ lines: a.lines, name: item.name, itemId: item.id });
        report.created++;
        if (item.status === 'in_review') report.held++;
      }
    });
    return report;
  }

  // ───────────── home kitchen slots (FR-CAT-5) ─────────────

  slots(merchant: MerchantRecord): Promise<SlotRecord[]> {
    return this.repo.slots(merchant.id);
  }

  async replaceSlots(merchant: MerchantRecord, actor: Actor, slots: SlotInput[]): Promise<SlotRecord[]> {
    if (merchant.type !== 'home_kitchen') throw new DomainError('INVALID_STATE', 'Delivery slots are for home kitchens');
    const problems = slotProblems(slots);
    if (problems.length) throw new DomainError('VALIDATION_FAILED', problems[0]!.message, { problems });
    return this.repo.transaction(async (tx) => {
      const out = await tx.replaceSlots(merchant.id, slots);
      await tx.appendEvent({
        type: 'merchant.slots_updated',
        aggregate: { type: 'merchant', id: merchant.id },
        microMarketId: merchant.microMarketId,
        actor: { type: 'user', id: actor.userId },
        payload: { merchant_id: merchant.id, slots: out.length },
      });
      return out;
    });
  }

  async slotAvailability(merchantId: string, days = 2) {
    return slotOccurrences(await this.repo.slots(merchantId), this.clock(), days);
  }

  // ───────────── ops: catalogue QA (FR-OPS-1, FR-CAT-7) ─────────────

  async qaSummary() {
    const [held, pendingMerchant, stale, media, requests] = await Promise.all([
      this.repo.countItems({ status: ['in_review'] }),
      this.repo.countItems({ status: ['pending_merchant'] }),
      this.repo.countItems({ staleOnly: true, status: ['active'] }),
      this.media.queue(500),
      this.repo.barcodeRequests('open', 500),
    ]);
    return { heldItems: held, pendingMerchantApproval: pendingMerchant, staleItems: stale, photosToReview: media.length, barcodeRequests: requests.length };
  }

  async review(id: string, decision: 'release' | 'reject', actor: Actor, note?: string): Promise<ItemView> {
    const i = await this.repo.getItem(id);
    if (!i || i.deletedAt) throw new DomainError('NOT_FOUND', 'Item not found');
    if (i.status !== 'in_review') throw new DomainError('INVALID_STATE', 'This item is not held for review');
    const status: ItemStatus = decision === 'release' ? 'active' : 'hidden';
    const updated = await this.repo.transaction(async (tx) => {
      const r = await tx.updateItem(id, { status, reviewReason: decision === 'reject' ? (note?.trim() || 'Not allowed on Santha') : null });
      await tx.appendEvent({
        type: decision === 'release' ? 'item.released' : 'item.rejected',
        aggregate: { type: 'item', id },
        microMarketId: i.microMarketId,
        actor: { type: 'ops', id: actor.userId },
        payload: { item_id: id, merchant_id: i.merchantId },
      });
      await tx.appendAudit({
        entity: 'item',
        entityId: id,
        action: decision === 'release' ? 'released' : 'rejected',
        actorId: actor.userId,
        microMarketId: i.microMarketId,
        before: { status: i.status, reason: i.reviewReason },
        after: { status, ...(note ? { note } : {}) },
        requestId: actor.requestId ?? null,
      });
      return r;
    });
    return this.view(updated);
  }

  // ───────────── staleness (tech plan 7.6) ─────────────

  /**
   * Flags items not confirmed within the micro-market's `sla.staleCatalogueHours` (default 72 h).
   * Stale items rank lower in search and are confirmed item by item at acceptance (M5).
   */
  async sweepStaleness(actor?: Actor): Promise<{ flagged: number }> {
    const now = this.clock();
    let flagged = 0;
    for (const { market, current } of await this.markets.list(now)) {
      if (!current) continue;
      const before = new Date(now.getTime() - current.sla.staleCatalogueHours * 3600_000);
      for (;;) {
        const batch = await this.repo.staleCandidates(market.id, before, 500);
        if (!batch.length) break;
        await this.repo.transaction(async (tx) => {
          await tx.flagStale(batch.map((b) => b.id), now);
          // One event per store, not per item: consumers (search, merchant nudges) act per store,
          // and a sweep can flag thousands of items at once.
          const byMerchant = new Map<string, string[]>();
          for (const b of batch) byMerchant.set(b.merchantId, [...(byMerchant.get(b.merchantId) ?? []), b.id]);
          for (const [merchantId, itemIds] of byMerchant)
            await tx.appendEvent({
              type: 'merchant.catalogue_went_stale',
              aggregate: { type: 'merchant', id: merchantId },
              microMarketId: market.id,
              actor: { type: 'system', id: null },
              payload: { merchant_id: merchantId, item_ids: itemIds, hours: current.sla.staleCatalogueHours },
            });
        });
        flagged += batch.length;
        if (batch.length < 500) break;
      }
    }
    if (flagged) this.logger.log(`staleness sweep flagged ${flagged} items`);
    if (actor)
      await this.repo.transaction((tx) =>
        tx.appendAudit({ entity: 'catalogue', entityId: 'staleness', action: 'staleness_sweep', actorId: actor.userId, after: { flagged }, requestId: actor.requestId ?? null }),
      );
    return { flagged };
  }

  // ───────────── for search-discovery (exported) ─────────────

  /** A live merchant's sellable items with consumer image URLs, for the search index. */
  async indexSnapshot(
    merchantId: string,
  ): Promise<{ merchant: MerchantRecord; items: ItemView[]; photos: MediaView[]; hasSlots: boolean; fssaiVerified: boolean } | null> {
    const merchant = await this.merchants.record(merchantId).catch(() => null);
    if (!merchant) return null;
    const [rows, photos, slots, fssaiVerified] = await Promise.all([
      this.repo.listItems({ merchantId, status: ['active'], limit: 20_000 }),
      this.merchants.approvedPhotos(merchant),
      this.repo.slots(merchantId),
      this.merchants.fssaiVerified(merchant),
    ]);
    return { merchant, items: await this.views(rows), photos, hasSlots: slots.length > 0, fssaiVerified };
  }

  async liveMerchantIds(): Promise<string[]> {
    return (await this.merchants.live()).map((m) => m.id);
  }

  async itemView(id: string): Promise<ItemView | null> {
    const i = await this.repo.getItem(id);
    return i ? this.view(i) : null;
  }

  // ───────────── helpers ─────────────

  private async ownedItem(merchant: MerchantRecord, id: string): Promise<ItemRecord> {
    const i = await this.repo.getItem(id);
    if (!i || i.merchantId !== merchant.id || i.deletedAt) throw new DomainError('NOT_FOUND', 'Item not found');
    return i;
  }

  async view(i: ItemRecord): Promise<ItemView> {
    return (await this.views([i]))[0]!;
  }

  async views(items: ItemRecord[]): Promise<ItemView[]> {
    const images = await this.media.views([...new Set(items.flatMap((i) => i.imageIds))]);
    const masters = new Map<string, MasterProductRecord | null>();
    for (const id of new Set(items.map((i) => i.masterProductId).filter((x): x is string => !!x))) masters.set(id, await this.repo.getMaster(id));
    return items.map((item) => {
      const own = item.imageIds.map((id) => images.find((m) => m.id === id)).filter((m): m is MediaView => !!m);
      const approved = own.find((m) => m.status === 'approved');
      return {
        item,
        images: own,
        imageUrl: approved?.mediumUrl ?? (item.masterProductId ? (masters.get(item.masterProductId)?.imageUrl ?? null) : null),
        stock: itemStock(item.variants),
        stale: !!item.staleSince,
      };
    });
  }
}
