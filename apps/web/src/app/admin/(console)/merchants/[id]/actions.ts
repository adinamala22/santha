'use server';

import { revalidatePath } from 'next/cache';
import { opsApi } from '@/lib/ops/server';

export interface DecisionState {
  ok: boolean;
  code?: string;
  message?: string;
}

/** approve | reject | go-live — the backend enforces roles, state and the FSSAI rule, and writes the audit row. */
export async function decide(id: string, _prev: DecisionState, form: FormData): Promise<DecisionState> {
  const action = String(form.get('action'));
  const note = String(form.get('note') ?? '').trim() || undefined;
  const path =
    action === 'approve' ? 'approve' : action === 'reject' ? 'reject' : action === 'go-live' ? 'go-live' : null;
  if (!path) return { ok: false, code: 'VALIDATION_FAILED' };
  const body = action === 'reject' ? { reasonCode: String(form.get('reasonCode')), note } : action === 'approve' ? { note } : undefined;
  const r = await opsApi(`/v1/ops/merchants/${id}/${path}`, { method: 'POST', body });
  revalidatePath(`/admin/merchants/${id}`);
  revalidatePath('/admin/merchants');
  return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message };
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Opening hours (ADR-021): one range per day, or closed; the API validates, audits and reindexes. */
export async function setHours(id: string, _prev: DecisionState, form: FormData): Promise<DecisionState> {
  const hours = Object.fromEntries(
    DAYS.map((d) => [d, form.get(`${d}-closed`) ? [] : [{ open: String(form.get(`${d}-open`) ?? ''), close: String(form.get(`${d}-close`) ?? '') }]]),
  );
  const r = await opsApi(`/v1/ops/merchants/${id}/hours`, { method: 'PUT', body: { hours, reason: String(form.get('reason') ?? '').trim() } });
  revalidatePath(`/admin/merchants/${id}`);
  return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message };
}

/** Delivery radius (ADR-019): the API audits it with the reason and reindexes the store. */
export async function setRadius(id: string, _prev: DecisionState, form: FormData): Promise<DecisionState> {
  const km = Number(String(form.get('km') ?? '').replace(',', '.'));
  const r = await opsApi(`/v1/ops/merchants/${id}/radius`, {
    method: 'PUT',
    body: { radiusM: Math.round(km * 1000), reason: String(form.get('reason') ?? '').trim() },
  });
  revalidatePath(`/admin/merchants/${id}`);
  return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message };
}
