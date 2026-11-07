'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/admin/confirm-action';
import { opsApi } from '@/lib/ops/server';

/** approve | reject | suspend a rider (ADR-029). The backend checks roles and state and writes the audit row. */
export async function decideRider(userId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const action = String(form.get('decision') ?? '');
  if (action !== 'approve' && action !== 'reject' && action !== 'suspend') return { ok: false, code: 'VALIDATION_FAILED' };
  const text = String(form.get('note') ?? '').trim();
  if (action !== 'approve' && text.length < 5) return { ok: false, code: 'REASON_REQUIRED' };
  const body = action === 'approve' ? (text ? { note: text } : {}) : { reason: text };
  const r = await opsApi(`/v1/ops/riders/${userId}/${action}`, { method: 'POST', body });
  revalidatePath(`/admin/riders/${userId}`);
  revalidatePath('/admin/riders');
  return r.ok ? { ok: true, done: action } : { ok: false, code: r.code, message: r.message };
}

/** Cash the rider handed over (ADR-032): rupees in, paise to the API; audited there. */
export async function recordDeposit(userId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const rupees = Number(String(form.get('amount') ?? '').replace(/,/g, ''));
  if (!Number.isFinite(rupees) || rupees <= 0) return { ok: false, code: 'VALIDATION_FAILED' };
  const note = String(form.get('note') ?? '').trim();
  const r = await opsApi(`/v1/ops/riders/${userId}/cash-deposits`, { method: 'POST', body: { amountPaise: Math.round(rupees * 100), ...(note ? { note } : {}) } });
  revalidatePath(`/admin/riders/${userId}`);
  return r.ok ? { ok: true, done: 'deposit' } : { ok: false, code: r.code, message: r.message };
}
