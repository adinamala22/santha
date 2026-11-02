'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/admin/confirm-action';
import { opsApi } from '@/lib/ops/server';

const KINDS = ['merchant', 'rider_daily', 'rider_weekly'] as const;

/** Run (or re-open) a settlement for an IST date; idempotent per period on the backend. */
export async function runSettlement(_prev: ActionState, form: FormData): Promise<ActionState> {
  const kind = String(form.get('kind'));
  const date = String(form.get('date') ?? '');
  if (!(KINDS as readonly string[]).includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi('/v1/ops/settlements/run', { method: 'POST', body: { kind, date } });
  revalidatePath('/admin/payouts');
  return r.ok ? { ok: true, done: 'run' } : { ok: false, code: r.code, message: r.message };
}

export async function retryPayout(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  if (String(form.get('decision')) !== 'retry') return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/payouts/${id}/retry`, { method: 'POST' });
  revalidatePath('/admin/payouts');
  return r.ok ? { ok: true, done: 'retry' } : { ok: false, code: r.code, message: r.message };
}

export async function reconcileDay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const date = String(form.get('date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi('/v1/ops/recon/run', { method: 'POST', body: { date } });
  revalidatePath('/admin/payouts');
  return r.ok ? { ok: true, done: 'recon' } : { ok: false, code: r.code, message: r.message };
}

export async function resolveRecon(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const note = String(form.get('note') ?? '').trim();
  if (note.length < 3) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/recon/${id}/resolve`, { method: 'POST', body: { note } });
  revalidatePath('/admin/payouts');
  return r.ok ? { ok: true, done: 'resolve' } : { ok: false, code: r.code, message: r.message };
}

/** Refund decision: approve (four-eyes above the threshold) or reject with a note. */
export async function decideRefund(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  const note = String(form.get('note') ?? '').trim();
  if (decision === 'reject' && note.length < 3) return { ok: false, code: 'VALIDATION_FAILED' };
  const r =
    decision === 'approve'
      ? await opsApi(`/v1/ops/refunds/${id}/approve`, { method: 'POST' })
      : decision === 'reject'
        ? await opsApi(`/v1/ops/refunds/${id}/reject`, { method: 'POST', body: { note } })
        : null;
  if (!r) return { ok: false, code: 'VALIDATION_FAILED' };
  revalidatePath('/admin/refunds');
  return r.ok ? { ok: true, done: decision } : { ok: false, code: r.code, message: r.message };
}

export async function decideDispute(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  const note = String(form.get('note') ?? '').trim();
  if ((decision !== 'accept' && decision !== 'reject') || note.length < 3) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/disputes/${id}/resolve`, { method: 'POST', body: { decision, note } });
  revalidatePath('/admin/disputes');
  return r.ok ? { ok: true, done: decision } : { ok: false, code: r.code, message: r.message };
}
