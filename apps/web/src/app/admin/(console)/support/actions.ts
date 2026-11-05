'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/admin/confirm-action';
import { opsApi } from '@/lib/ops/server';

const refresh = (id: string) => {
  revalidatePath('/admin/support');
  revalidatePath(`/admin/support/${id}`);
};

/** Reply in a support chat (ADR-028); the person gets a notification; audited by the backend. */
export async function replyToChat(threadId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = String(form.get('body') ?? '').trim();
  if (!body) return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/support/threads/${threadId}/messages`, { method: 'POST', body: { body } });
  refresh(threadId);
  return r.ok ? { ok: true, done: 'sent' } : { ok: false, code: r.code, message: r.message };
}

/** Assign to me, or resolve (audited). */
export async function chatDecision(threadId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision') ?? '');
  if (decision !== 'assign' && decision !== 'resolve') return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/support/threads/${threadId}/${decision}`, { method: 'POST', body: {} });
  refresh(threadId);
  return r.ok ? { ok: true, done: decision } : { ok: false, code: r.code, message: r.message };
}
