import { csvRecords } from '../../../common/csv';
import { ALLERGENS, FOOD_MARKS, ITEM_UNITS, type FoodMark, type ItemUnit, type StockState, STOCK_STATES } from './catalogue';
import { isValidGtin } from './gtin';

/** Rupees as typed by people ("55", "55.5", "₹ 1,250.00") → integer paise; null if not a price. */
export function rupeesToPaise(raw: string): number | null {
  const s = raw.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}

export const IMPORT_COLUMNS = ['name', 'name_te', 'category', 'size', 'unit', 'qty', 'price', 'mrp', 'stock', 'food_mark', 'allergens', 'barcode', 'description'] as const;
export const REQUIRED_COLUMNS = ['name', 'category', 'price'] as const;
export const MAX_IMPORT_ROWS = 2000;

export interface ImportVariant {
  label: string;
  unit: ItemUnit;
  unitQty: number;
  pricePaise: number;
  mrpPaise: number | null;
  stock: StockState;
}

export interface ImportItem {
  lines: number[];
  name: string;
  nameTe: string | null;
  categorySlug: string;
  description: string | null;
  foodMark: FoodMark | null;
  allergens: string[];
  barcode: string | null;
  variants: ImportVariant[];
}

export interface RejectedRow {
  line: number;
  reasons: string[];
}

/**
 * Parses a merchant's bulk CSV (FR-CAT-4) into item drafts. One row per size; consecutive rows
 * with the same name become variants of one item. Row-level problems are reported with the file
 * line; item-level rules (category for this store, price ≤ MRP…) are checked by the service.
 */
export function parseItemImport(text: string): { items: ImportItem[]; rejected: RejectedRow[]; headerProblems: string[] } {
  const { header, records } = csvRecords(text);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { items: [], rejected: [], headerProblems: [`Missing columns: ${missing.join(', ')}`] };
  if (records.length > MAX_IMPORT_ROWS) return { items: [], rejected: [], headerProblems: [`Up to ${MAX_IMPORT_ROWS} rows per file`] };

  const items: ImportItem[] = [];
  const rejected: RejectedRow[] = [];
  for (const { line, values: v } of records) {
    const reasons: string[] = [];
    const price = rupeesToPaise(v.price ?? '');
    if (price == null || price <= 0) reasons.push('price is not a valid amount');
    const mrp = v.mrp ? rupeesToPaise(v.mrp) : null;
    if (v.mrp && mrp == null) reasons.push('mrp is not a valid amount');
    const unit = (v.unit || 'pc').toLowerCase() as ItemUnit;
    if (!(ITEM_UNITS as readonly string[]).includes(unit)) reasons.push(`unit must be one of ${ITEM_UNITS.join(', ')}`);
    const qty = v.qty ? Number(v.qty) : 1;
    if (!(qty > 0)) reasons.push('qty must be a number above 0');
    const stock = (v.stock || 'in').toLowerCase() as StockState;
    if (!(STOCK_STATES as readonly string[]).includes(stock)) reasons.push('stock must be in, low or out');
    const foodMark = v.food_mark ? (v.food_mark.toLowerCase().replace(/[\s-]/g, '_') as FoodMark) : null;
    if (foodMark && !(FOOD_MARKS as readonly string[]).includes(foodMark)) reasons.push('food_mark must be veg, non_veg or egg');
    const allergens = (v.allergens ?? '').split(/[;|]/).map((a) => a.trim().toLowerCase()).filter(Boolean);
    const unknown = allergens.filter((a) => !(ALLERGENS as readonly string[]).includes(a));
    if (unknown.length) reasons.push(`unknown allergens: ${unknown.join(', ')}`);
    const barcode = v.barcode ? v.barcode.replace(/\s/g, '') : null;
    if (barcode && !isValidGtin(barcode)) reasons.push('barcode check digit is wrong');
    if (!v.name || v.name.length < 2) reasons.push('name is missing');
    if (!v.category) reasons.push('category is missing');
    if (reasons.length) {
      rejected.push({ line, reasons });
      continue;
    }
    const variant: ImportVariant = {
      label: v.size || `${qty} ${unit}`,
      unit,
      unitQty: qty,
      pricePaise: price!,
      mrpPaise: mrp,
      stock,
    };
    const prev = items.at(-1);
    if (prev && prev.name.toLowerCase() === v.name!.toLowerCase() && prev.categorySlug === v.category) {
      prev.variants.push(variant);
      prev.lines.push(line);
    } else
      items.push({
        lines: [line],
        name: v.name!,
        nameTe: v.name_te || null,
        categorySlug: v.category!,
        description: v.description || null,
        foodMark,
        allergens,
        barcode,
        variants: [variant],
      });
  }
  return { items, rejected, headerProblems: [] };
}
