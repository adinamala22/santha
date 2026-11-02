import type { ItemDoc, MerchantDoc } from './domain/documents';
import { expandQuery, type QueryTerm } from './domain/synonyms';
import { editDistance, tokenize, typoBudget } from './domain/text';
import { type Hit, type ItemSearch, SearchIndex } from './search-index';

/** Field weights, mirroring the Typesense query_by_weights. */
const ITEM_FIELDS = [
  ['name', 1],
  ['nameTe', 1],
  ['brand', 0.7],
  ['categoryName', 0.5],
  ['categoryNameTe', 0.5],
  ['merchantName', 0.3],
] as const;
const MERCHANT_FIELDS = [
  ['name', 1],
  ['nameTe', 1],
  ['category', 0.4],
  ['description', 0.3],
] as const;

const EXACT = 1;
const PREFIX = 0.8;
const TYPO = 0.6;

interface Entry<T> {
  doc: T;
  /** Tokens per field, aligned with the field weights. */
  fields: string[][];
}

/**
 * A small inverted index: token → doc ids, plus per-doc field tokens for scoring. Matches exact
 * tokens, prefixes (last query token only, as you type) and typos (edit distance by length), with
 * synonym expansion. All query terms must match; if nothing does, terms are dropped from the end
 * (like Typesense drop_tokens) so long queries still find something.
 */
class TextIndex<T extends { id: string }> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly postings = new Map<string, Set<string>>();

  constructor(private readonly fields: ReadonlyArray<readonly [keyof T & string, number]>) {}

  get size(): number {
    return this.entries.size;
  }

  values(): IterableIterator<Entry<T>> {
    return this.entries.values();
  }

  put(doc: T): void {
    this.remove(doc.id);
    const fields = this.fields.map(([f]) => tokenize(doc[f] as unknown as string | null));
    this.entries.set(doc.id, { doc, fields });
    for (const t of new Set(fields.flat())) {
      let set = this.postings.get(t);
      if (!set) this.postings.set(t, (set = new Set()));
      set.add(doc.id);
    }
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    for (const t of new Set(e.fields.flat())) {
      const set = this.postings.get(t);
      set?.delete(id);
      if (set?.size === 0) this.postings.delete(t);
    }
    this.entries.delete(id);
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.doc;
  }

  /** Vocabulary tokens a query token can match, with the match quality. */
  private expand(token: string, allowPrefix: boolean): Map<string, number> {
    const out = new Map<string, number>();
    if (this.postings.has(token)) out.set(token, EXACT);
    const budget = typoBudget(token.length);
    if (!allowPrefix && budget === 0) return out;
    for (const v of this.postings.keys()) {
      if (out.has(v)) continue;
      if (allowPrefix && token.length >= 2 && v.length > token.length && v.startsWith(token)) out.set(v, PREFIX);
      else if (budget > 0 && Math.abs(v.length - token.length) <= budget && v[0] === token[0] && editDistance(token, v, budget) <= budget) out.set(v, TYPO);
    }
    return out;
  }

  search(q: string, filter: (doc: T) => boolean, limit: number): Hit<T>[] {
    const terms = expandQuery(q);
    if (!terms.length) return [];
    for (let n = terms.length; n >= 1; n--) {
      const hits = this.run(terms.slice(0, n), filter);
      if (hits.length) return hits.slice(0, limit);
    }
    return [];
  }

  private run(terms: QueryTerm[], filter: (doc: T) => boolean): Hit<T>[] {
    // Per term: vocabulary matches for every token of every alternative.
    const lastIdx = terms.length - 1;
    const termMatches = terms.map((alts, ti) =>
      alts.map((tokens) => tokens.map((tok, k) => this.expand(tok, ti === lastIdx && k === tokens.length - 1))),
    );
    // Candidates: docs containing a match for the first token of some alternative of every term.
    let candidates: Set<string> | undefined;
    for (const alts of termMatches) {
      const ids = new Set<string>();
      for (const alt of alts) for (const v of alt[0]!.keys()) for (const id of this.postings.get(v) ?? []) ids.add(id);
      const prev: Set<string> | undefined = candidates;
      candidates = prev ? new Set([...prev].filter((id: string) => ids.has(id))) : ids;
      if (!candidates.size) return [];
    }
    const scored: Hit<T>[] = [];
    for (const id of candidates ?? []) {
      const e = this.entries.get(id)!;
      if (!filter(e.doc)) continue;
      let total = 0;
      let ok = true;
      for (const alts of termMatches) {
        let best = 0;
        for (const alt of alts) {
          let altScore = Infinity;
          for (const vocab of alt) {
            let tokBest = 0;
            e.fields.forEach((toks, fi) => {
              const w = this.fields[fi]![1];
              for (const t of toks) {
                const m = vocab.get(t);
                if (m && m * w > tokBest) tokBest = m * w;
              }
            });
            altScore = Math.min(altScore, tokBest);
          }
          if (altScore > best) best = altScore;
        }
        if (best === 0) {
          ok = false;
          break;
        }
        total += best;
      }
      if (ok) scored.push({ doc: e.doc, text: total / terms.length });
    }
    return scored.sort((a, b) => b.text - a.text || a.doc.id.localeCompare(b.doc.id));
  }
}

/** Fake-mode / unit-test search engine. Rebuilt from the catalogue at boot (data is in memory anyway). */
export class InMemorySearchIndex extends SearchIndex {
  readonly engine = 'memory' as const;
  private readonly items = new TextIndex<ItemDoc>(ITEM_FIELDS);
  private readonly merchants = new TextIndex<MerchantDoc>(MERCHANT_FIELDS);
  private readonly itemsByMerchant = new Map<string, Set<string>>();

  async ensure(): Promise<void> {}

  async replaceMerchant(merchant: MerchantDoc, items: ItemDoc[]): Promise<void> {
    const keep = new Set(items.map((i) => i.id));
    for (const id of this.itemsByMerchant.get(merchant.id) ?? []) if (!keep.has(id)) this.items.remove(id);
    for (const i of items) this.items.put(i);
    this.itemsByMerchant.set(merchant.id, keep);
    this.merchants.put(merchant);
  }

  async removeMerchant(merchantId: string): Promise<void> {
    for (const id of this.itemsByMerchant.get(merchantId) ?? []) this.items.remove(id);
    this.itemsByMerchant.delete(merchantId);
    this.merchants.remove(merchantId);
  }

  async searchItems(s: ItemSearch): Promise<Hit<ItemDoc>[]> {
    const filter = (d: ItemDoc) =>
      d.microMarketId === s.microMarketId && (!s.inStockOnly || d.inStock) && (!s.vegOnly || d.foodMark === 'veg') && (!s.categorySlug || d.categorySlug === s.categorySlug);
    if (!s.q.trim())
      return [...this.items.values()].map((e) => e.doc).filter(filter).sort((a, b) => a.name.localeCompare(b.name)).slice(0, s.limit).map((doc) => ({ doc, text: 1 }));
    const hits = this.items.search(s.q, filter, s.limit);
    const max = hits[0]?.text ?? 1;
    return hits.map((h) => ({ doc: h.doc, text: h.text / max }));
  }

  async searchMerchants(q: string, microMarketId: string, limit: number): Promise<Hit<MerchantDoc>[]> {
    const hits = this.merchants.search(q, (d) => d.microMarketId === microMarketId, limit);
    const max = hits[0]?.text ?? 1;
    return hits.map((h) => ({ doc: h.doc, text: h.text / max }));
  }

  async merchantsIn(microMarketId: string): Promise<MerchantDoc[]> {
    return [...this.merchants.values()].map((e) => e.doc).filter((d) => d.microMarketId === microMarketId);
  }

  async counts(): Promise<{ items: number; merchants: number }> {
    return { items: this.items.size, merchants: this.merchants.size };
  }
}
