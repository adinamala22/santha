/**
 * Master catalogue import (FR-CAT-1): `pnpm --filter backend catalogue:import <file.csv> [--dry-run]`.
 * CSV columns: barcode,name,brand,mrp,pack,category,image_url (mrp in rupees; `#` lines are comments).
 * Upserts by barcode, so re-importing a corrected file updates rows. Rejected rows are reported
 * with their line and reasons; nothing is written for them.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { parseMasterCsv } from '../src/modules/merchant-catalogue/domain/master-import';

async function main(): Promise<void> {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  if (!file) throw new Error('Usage: catalogue:import <file.csv> [--dry-run]');
  const { rows, rejected } = parseMasterCsv(readFileSync(file, 'utf8'), 'import');
  for (const r of rejected) console.warn(`line ${r.line}: ${r.reasons.join('; ')}`);
  console.log(`${rows.length} valid rows, ${rejected.length} rejected${dryRun ? ' (dry run, nothing written)' : ''}`);
  if (dryRun) return;
  const prisma = new PrismaClient();
  try {
    let created = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      await prisma.$transaction(async (tx) => {
        for (const r of batch) {
          const before = await tx.masterProduct.findUnique({ where: { barcode: r.barcode }, select: { id: true } });
          await tx.masterProduct.upsert({ where: { barcode: r.barcode }, create: r, update: r });
          if (!before) created++;
        }
      });
    }
    console.log(`Imported: ${created} new, ${rows.length - created} updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
