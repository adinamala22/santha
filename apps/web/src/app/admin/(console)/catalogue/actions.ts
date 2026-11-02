'use server';

import type { ImportReport } from '@santha/shared-types';
import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/admin/confirm-action';
import { rupeeInputToPaise } from '@/lib/format';
import { opsApi } from '@/lib/ops/server';

const done = (r: { ok: boolean; code?: string; message?: string }): ActionState => (r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message });

/** Held item: release (allow) or reject. The backend checks the role and writes the audit row. */
export async function reviewItem(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  if (decision !== 'release' && decision !== 'reject') return { ok: false, code: 'VALIDATION_FAILED' };
  const note = String(form.get('note') ?? '').trim() || undefined;
  const r = await opsApi(`/v1/ops/catalogue/items/${id}/review`, { method: 'POST', body: { decision, note } });
  revalidatePath('/admin/catalogue');
  return r.ok ? { ok: true, done: decision } : { ok: false, code: r.code, message: r.message };
}

/** Photo moderation: approve or reject (customers only ever see approved photos). */
export async function reviewMedia(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, code: 'VALIDATION_FAILED' };
  const reason = String(form.get('note') ?? '').trim() || undefined;
  const r = await opsApi(`/v1/ops/catalogue/media/${id}/review`, { method: 'POST', body: { decision, reason } });
  revalidatePath('/admin/catalogue');
  return r.ok ? { ok: true, done: decision } : done(r);
}

/** Enrichment: add an unknown barcode to the master catalogue. */
export async function enrichBarcode(barcode: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const mrp = String(form.get('mrp') ?? '').trim();
  const r = await opsApi('/v1/ops/catalogue/master', {
    method: 'POST',
    body: {
      barcode,
      name: String(form.get('name') ?? '').trim(),
      brand: String(form.get('brand') ?? '').trim() || null,
      mrpPaise: mrp ? rupeeInputToPaise(mrp) : null,
      packLabel: String(form.get('pack') ?? '').trim() || null,
      categorySlug: String(form.get('category') ?? ''),
    },
  });
  revalidatePath('/admin/catalogue');
  return done(r);
}

/** Assisted entry: one item built for the merchant's approval (FR-CAT-3). */
export async function assistedCreate(merchantId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const mrp = String(form.get('mrp') ?? '').trim();
  const foodMark = String(form.get('foodMark') ?? 'none');
  const r = await opsApi(`/v1/ops/catalogue/merchants/${merchantId}/items`, {
    method: 'POST',
    body: {
      name: String(form.get('name') ?? '').trim(),
      nameTe: String(form.get('nameTe') ?? '').trim() || null,
      categorySlug: String(form.get('category') ?? ''),
      foodMark: foodMark === 'none' ? null : foodMark,
      variants: [
        {
          label: String(form.get('size') ?? '').trim() || '1 pc',
          unit: String(form.get('unit') ?? 'pc'),
          unitQty: Number(form.get('qty') ?? 1) || 1,
          pricePaise: rupeeInputToPaise(String(form.get('price') ?? '0')),
          mrpPaise: mrp ? rupeeInputToPaise(mrp) : null,
        },
      ],
    },
  });
  revalidatePath(`/admin/merchants/${merchantId}/catalogue`);
  return done(r);
}

export interface ImportState extends ActionState {
  report?: ImportReport;
}

/** Assisted bulk entry: dry run first (report), then the real import. */
export async function assistedImport(merchantId: string, _prev: ImportState, form: FormData): Promise<ImportState> {
  const csv = String(form.get('csv') ?? '');
  const dryRun = String(form.get('mode')) !== 'import';
  const r = await opsApi<ImportReport>(`/v1/ops/catalogue/merchants/${merchantId}/items/import`, { method: 'POST', body: { csv, dryRun } });
  if (!dryRun) revalidatePath(`/admin/merchants/${merchantId}/catalogue`);
  return r.ok ? { ok: true, report: r.data } : { ok: false, code: r.code, message: r.message };
}
