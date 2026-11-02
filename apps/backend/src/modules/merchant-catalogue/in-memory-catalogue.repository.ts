import { randomUUID } from 'node:crypto';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { MemoryStore } from '../../infra/fake/memory-tx';
import {
  CatalogueRepository,
  type CatalogueTx,
  type ItemQuery,
  type MediaPatch,
  type NewItem,
  type NewMaster,
  type NewMedia,
} from './catalogue.repository';
import type {
  BarcodeRequestRecord,
  ItemRecord,
  MasterProductRecord,
  MediaRecord,
  SlotRecord,
  VariantInput,
  VariantRecord,
} from './domain/catalogue';

interface State {
  items: ItemRecord[];
  master: MasterProductRecord[];
  requests: BarcodeRequestRecord[];
  slots: SlotRecord[];
  media: MediaRecord[];
}

const matches = (i: ItemRecord, q: Omit<ItemQuery, 'limit' | 'offset'>) => {
  if (i.deletedAt) return false;
  if (q.merchantId && i.merchantId !== q.merchantId) return false;
  if (q.status?.length && !q.status.includes(i.status)) return false;
  if (q.categorySlug && i.categorySlug !== q.categorySlug) return false;
  if (q.staleOnly && !i.staleSince) return false;
  const t = q.q?.trim().toLowerCase();
  if (t && ![i.name, i.nameTe ?? '', i.brand ?? ''].some((f) => f.toLowerCase().includes(t))) return false;
  return true;
};

const byCategoryName = (a: ItemRecord, b: ItemRecord) =>
  a.categorySlug.localeCompare(b.categorySlug) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Fake-mode catalogue (DATA_STORE=memory), loaded with the demo catalogue at boot. */
export class InMemoryCatalogueRepository extends CatalogueRepository {
  private readonly store: CatalogueStore;

  constructor(sinks?: FakeSinks) {
    super();
    this.store = new CatalogueStore(sinks);
  }

  transaction<T>(fn: (tx: CatalogueTx) => Promise<T>): Promise<T> {
    return this.store.tx(fn);
  }

  async getItem(id: string) {
    return this.store.read((s) => s.items.find((i) => i.id === id) ?? null);
  }

  async listItems(q: ItemQuery) {
    const off = q.offset ?? 0;
    return this.store.read((s) => s.items.filter((i) => matches(i, q)).sort(byCategoryName).slice(off, off + q.limit));
  }

  async countItems(q: Omit<ItemQuery, 'limit' | 'offset'>) {
    return this.store.read((s) => s.items.filter((i) => matches(i, q)).length);
  }

  async staleCandidates(microMarketId: string | null, before: Date, limit: number) {
    return this.store.read((s) =>
      s.items
        .filter((i) => i.microMarketId === microMarketId && i.status === 'active' && !i.deletedAt && !i.staleSince && i.confirmedAt < before)
        .sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime())
        .slice(0, limit)
        .map((i) => ({ id: i.id, merchantId: i.merchantId, confirmedAt: i.confirmedAt })),
    );
  }

  async masterByBarcode(codes: string[]) {
    return this.store.read((s) => s.master.find((m) => codes.includes(m.barcode)) ?? null);
  }

  async getMaster(id: string) {
    return this.store.read((s) => s.master.find((m) => m.id === id) ?? null);
  }

  async searchMaster(q: string, limit: number) {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    return this.store.read((s) =>
      s.master
        .filter((m) => words.every((w) => m.name.toLowerCase().includes(w) || (m.brand ?? '').toLowerCase().includes(w)))
        .sort((a, b) => a.name.localeCompare(b.name) || a.barcode.localeCompare(b.barcode))
        .slice(0, limit),
    );
  }

  async countMaster() {
    return this.store.read((s) => s.master.length);
  }

  async barcodeRequests(status: 'open' | 'resolved', limit: number) {
    return this.store.read((s) =>
      s.requests
        .filter((r) => r.status === status)
        .sort((a, b) => b.scanCount - a.scanCount || a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit),
    );
  }

  async slots(merchantId: string) {
    return this.store.read((s) => s.slots.filter((x) => x.merchantId === merchantId).sort((a, b) => a.position - b.position));
  }

  async getMedia(id: string) {
    return this.store.read((s) => s.media.find((m) => m.id === id) ?? null);
  }

  async mediaByIds(ids: string[]) {
    return this.store.read((s) => s.media.filter((m) => ids.includes(m.id)));
  }

  async listMedia(q: { status?: MediaRecord['status'] | undefined; merchantId?: string | undefined; limit: number }) {
    return this.store.read((s) =>
      s.media
        .filter((m) => (!q.status || m.status === q.status) && (!q.merchantId || m.merchantId === q.merchantId))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  /** Demo rows straight into the store (no events) — fake-mode boot only. */
  seed(rows: Partial<State>): void {
    this.store.load(rows);
  }
}

class CatalogueStore extends MemoryStore<State> {
  constructor(sinks?: FakeSinks) {
    super({ items: [], master: [], requests: [], slots: [], media: [] }, sinks);
  }

  read<T>(fn: (s: State) => T): T {
    return this.clone(fn(this.state));
  }

  load(rows: Partial<State>): void {
    for (const k of ['items', 'master', 'requests', 'slots', 'media'] as const) this.state[k].push(...(this.clone(rows[k] ?? []) as never[]));
  }

  private item(id: string): ItemRecord {
    const i = this.state.items.find((x) => x.id === id);
    if (!i) throw new Error(`item ${id} not found`);
    return i;
  }

  private variants(itemId: string, input: VariantInput[], existing: VariantRecord[]): VariantRecord[] {
    return input.map((v, position) => ({
      id: v.id && existing.some((e) => e.id === v.id) ? v.id : randomUUID(),
      itemId,
      label: v.label.trim(),
      unit: v.unit,
      unitQty: v.unitQty,
      pricePaise: v.pricePaise,
      mrpPaise: v.mrpPaise ?? null,
      stock: v.stock ?? 'in',
      position,
    }));
  }

  tx<T>(fn: (tx: CatalogueTx) => Promise<T>): Promise<T> {
    return this.runTx((fx) =>
      fn({
        lockItem: async (id) => this.clone(this.state.items.find((i) => i.id === id) ?? null),
        createItem: async (input: NewItem) => {
          const id = randomUUID();
          const now = new Date();
          const { variants, ...rest } = input;
          for (const v of variants) if (v.mrpPaise != null && v.pricePaise > v.mrpPaise) throw new Error('check: item_variants_price_le_mrp');
          const rec: ItemRecord = { ...rest, id, staleSince: null, createdAt: now, updatedAt: now, deletedAt: null, variants: this.variants(id, variants, []) };
          this.state.items.push(rec);
          return this.clone(rec);
        },
        updateItem: async (id, patch, variants) => {
          const i = this.item(id);
          if (variants) for (const v of variants) if (v.mrpPaise != null && v.pricePaise > v.mrpPaise) throw new Error('check: item_variants_price_le_mrp');
          Object.assign(i, this.clone(patch), { updatedAt: new Date() });
          if (variants) i.variants = this.variants(id, variants, i.variants);
          return this.clone(i);
        },
        setStock: async (itemId, variantId, stock, at) => {
          const i = this.item(itemId);
          for (const v of i.variants) if (!variantId || v.id === variantId) v.stock = stock;
          Object.assign(i, { confirmedAt: at, staleSince: null, updatedAt: at });
          return this.clone(i);
        },
        confirmAll: async (merchantId, at) => {
          const touched = this.state.items.filter((i) => i.merchantId === merchantId && !i.deletedAt && (i.status === 'active' || i.status === 'in_review'));
          for (const i of touched) Object.assign(i, { confirmedAt: at, staleSince: null, updatedAt: at });
          return touched.map((i) => i.id);
        },
        flagStale: async (ids, at) => {
          for (const i of this.state.items) if (ids.includes(i.id) && !i.staleSince) i.staleSince = at;
        },
        upsertMaster: async (m: NewMaster) => {
          const now = new Date();
          const existing = this.state.master.find((x) => x.barcode === m.barcode);
          if (existing) {
            Object.assign(existing, this.clone(m), { updatedAt: now });
            return this.clone(existing);
          }
          const rec: MasterProductRecord = { ...m, id: randomUUID(), createdAt: now, updatedAt: now };
          this.state.master.push(rec);
          return this.clone(rec);
        },
        recordBarcodeRequest: async (barcode, merchantId) => {
          let r = this.state.requests.find((x) => x.barcode === barcode);
          if (r) Object.assign(r, { scanCount: r.scanCount + 1, lastMerchantId: merchantId });
          else {
            r = { id: randomUUID(), barcode, scanCount: 1, lastMerchantId: merchantId, status: 'open', masterProductId: null, createdAt: new Date(), resolvedAt: null, resolvedBy: null };
            this.state.requests.push(r);
          }
          return this.clone(r);
        },
        resolveBarcodeRequest: async (barcode, masterProductId, by, at) => {
          const r = this.state.requests.find((x) => x.barcode === barcode && x.status === 'open');
          if (r) Object.assign(r, { status: 'resolved', masterProductId, resolvedBy: by, resolvedAt: at });
        },
        replaceSlots: async (merchantId, slots) => {
          this.state.slots = this.state.slots.filter((s) => s.merchantId !== merchantId);
          const recs: SlotRecord[] = slots.map((s, position) => ({
            id: randomUUID(),
            merchantId,
            label: s.label ?? null,
            days: [...s.days],
            start: s.start,
            end: s.end,
            cutoffMin: s.cutoffMin,
            capacity: s.capacity,
            position,
          }));
          this.state.slots.push(...recs);
          return this.clone(recs);
        },
        createMedia: async (m: NewMedia) => {
          const rec: MediaRecord = { ...m, id: randomUUID(), variants: null, rejectReason: null, reviewedBy: null, reviewedAt: null, createdAt: new Date() };
          this.state.media.push(rec);
          return this.clone(rec);
        },
        updateMedia: async (id, patch: MediaPatch) => {
          const m = this.state.media.find((x) => x.id === id);
          if (!m) throw new Error(`media ${id} not found`);
          Object.assign(m, this.clone(patch));
          return this.clone(m);
        },
        appendEvent: async (e) => fx.event(e),
        appendAudit: async (a) => fx.audit(a),
      }),
    );
  }
}
