'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/admin/confirm-action';
import { fromLocalInput, rupeeInputToPaise } from '@/lib/format';
import { opsApi } from '@/lib/ops/server';

const PROMO_TYPES = ['retail', 'fashion', 'home_business', 'home_kitchen'] as const;

/** New promo code. The backend validates, upper-cases the code and writes the audit row. */
export async function createPromo(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = (k: string) => String(form.get(k) ?? '').trim();
  const kind = s('kind') === 'percent' ? 'percent' : 'flat';
  const money = (k: string) => (s(k) ? rupeeInputToPaise(s(k)) : null);
  const type = s('type');
  const r = await opsApi('/v1/ops/promos', {
    method: 'POST',
    body: {
      code: s('code'),
      description: s('description'),
      descriptionTe: s('descriptionTe'),
      kind,
      value: kind === 'percent' ? Number(s('value')) : rupeeInputToPaise(s('value')),
      maxDiscountPaise: money('maxDiscount'),
      minOrderPaise: money('minOrder') ?? 0,
      budgetPaise: money('budget'),
      perUserLimit: Number(s('perUser') || '1'),
      firstOrderOnly: form.get('firstOrder') === 'on',
      merchantSharePercent: Number(s('merchantShare') || '0'),
      merchantTypes: (PROMO_TYPES as readonly string[]).includes(type) ? [type] : [],
      validFrom: fromLocalInput(s('validFrom')) ?? new Date().toISOString(),
      validTo: fromLocalInput(s('validTo')) ?? null,
    },
  });
  revalidatePath('/admin/promos');
  return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message };
}

/** Pause or resume a code (customers can no longer apply a paused code). */
export async function setPromoActive(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = String(form.get('decision'));
  if (decision !== 'pause' && decision !== 'resume') return { ok: false, code: 'VALIDATION_FAILED' };
  const r = await opsApi(`/v1/ops/promos/${id}`, { method: 'PATCH', body: { active: decision === 'resume' } });
  revalidatePath('/admin/promos');
  return r.ok ? { ok: true, done: decision } : { ok: false, code: r.code, message: r.message };
}
