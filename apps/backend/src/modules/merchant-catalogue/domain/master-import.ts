import { csvRecords } from '../../../common/csv';
import type { MasterProductRecord, MasterSource } from './catalogue';
import { isValidGtin } from './gtin';
import { rupeesToPaise, type RejectedRow } from './import';
import { categoryBySlug } from './taxonomy';

export type MasterRow = Omit<MasterProductRecord, 'id' | 'createdAt' | 'updatedAt'>;

const PACK = /^(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pc|pack)$/i;

/**
 * Parses a master-catalogue CSV (GS1 / commercial export, or the demo file in prisma/data):
 * `barcode,name,brand,mrp,pack,category,image_url`. Lines starting with `#` are comments.
 * Duplicate barcodes keep the last row (later rows correct earlier ones).
 */
export function parseMasterCsv(text: string, source: MasterSource = 'import'): { rows: MasterRow[]; rejected: RejectedRow[] } {
  const body = text
    .split(/\r?\n/)
    .map((l) => (l.trimStart().startsWith('#') ? '' : l))
    .join('\n');
  const { header, records } = csvRecords(body);
  for (const c of ['barcode', 'name', 'category'])
    if (!header.includes(c)) return { rows: [], rejected: [{ line: 1, reasons: [`missing column ${c}`] }] };
  const byBarcode = new Map<string, MasterRow>();
  const rejected: RejectedRow[] = [];
  // csvRecords numbers lines after blanking comments, so its line numbers match the file.
  for (const { line, values: v } of records) {
    const reasons: string[] = [];
    const barcode = (v.barcode ?? '').replace(/\s/g, '');
    if (!isValidGtin(barcode)) reasons.push('barcode is not a valid GTIN');
    if (!v.name) reasons.push('name is missing');
    if (!v.category || !categoryBySlug(v.category)) reasons.push(`unknown category ${v.category ?? ''}`);
    const mrp = v.mrp ? rupeesToPaise(v.mrp) : null;
    if (v.mrp && (mrp == null || mrp <= 0)) reasons.push('mrp is not a valid amount');
    const pack = v.pack ? v.pack.match(PACK) : null;
    if (reasons.length) {
      rejected.push({ line, reasons });
      continue;
    }
    byBarcode.set(barcode, {
      barcode,
      name: v.name!,
      brand: v.brand || null,
      mrpPaise: mrp,
      packLabel: v.pack || null,
      unit: pack ? (pack[2]!.toLowerCase() as MasterRow['unit']) : null,
      unitQty: pack ? Number(pack[1]) : null,
      categorySlug: v.category!,
      imageUrl: v.image_url || null,
      source,
    });
  }
  return { rows: [...byBarcode.values()], rejected };
}

/** Deterministic id for a seeded master product, so demo items can reference it in both modes. */
export const seedMasterId = (barcode: string) => `50000000-0000-4000-8000-${barcode.slice(0, 12)}`;
