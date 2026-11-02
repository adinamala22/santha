'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/admin/confirm-action';
import { opsApi } from '@/lib/ops/server';

/** Give a delivery to a specific online rider (audited by the backend). */
export async function reassignOrder(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const riderUserId = String(form.get('riderUserId') ?? '');
  if (!riderUserId) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/orders/${orderId}/reassign`, { method: 'POST', body: { riderUserId } });
  revalidatePath('/admin/live');
  return r.ok ? { ok: true, done: 'reassign' } : { ok: false, code: r.code, message: r.message };
}

/** Have the store deliver the order itself (audited). */
export async function forceSelf(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  if (String(form.get('decision')) !== 'force') return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/orders/${orderId}/force-self`, { method: 'POST', body: {} });
  revalidatePath('/admin/live');
  return r.ok ? { ok: true, done: 'force' } : { ok: false, code: r.code, message: r.message };
}
