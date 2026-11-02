'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/admin/confirm-action';
import { opsApi } from '@/lib/ops/server';

const done = (r: { ok: boolean; code?: string; message?: string }, value: string): ActionState => (r.ok ? { ok: true, done: value } : { ok: false, code: r.code, message: r.message });

export async function grievanceAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  const note = String(form.get('note') ?? '').trim();
  let r;
  if (decision === 'ack') r = await opsApi(`/v1/ops/grievances/${id}/acknowledge`, { method: 'POST' });
  else if (decision === 'resolve') {
    if (note.length < 5) return { ok: false, code: 'VALIDATION_FAILED' };
    r = await opsApi(`/v1/ops/grievances/${id}/resolve`, { method: 'POST', body: { resolution: note } });
  } else return { ok: false, code: 'VALIDATION_FAILED' };
  revalidatePath('/admin/grievances');
  return done(r, decision);
}

export async function dataRequestAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  const note = String(form.get('note') ?? '').trim();
  if ((decision !== 'complete' && decision !== 'reject') || note.length < 3) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/data-requests/${id}/decide`, { method: 'POST', body: { decision, note } });
  revalidatePath('/admin/privacy');
  return done(r, decision);
}

export async function reviewAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  if (decision !== 'publish' && decision !== 'hide') return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/reviews/${orderId}/moderate`, { method: 'POST', body: { decision } });
  revalidatePath('/admin/reviews');
  return done(r, decision);
}

export async function leadAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const status = String(form.get('decision'));
  if (!['contacted', 'converted', 'dropped'].includes(status)) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/leads/${id}`, { method: 'PATCH', body: { status } });
  revalidatePath('/admin/leads');
  return done(r, status);
}
