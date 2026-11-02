'use client';

import { useActionState, useId } from 'react';
import type { ActionState } from '@/components/admin/confirm-action';
import { Notice } from '@/components/admin/ui';
import type { PromoCopy } from '@/i18n/promos';

const input = 'mt-1 h-10 w-full rounded-md border border-indigo-100 px-3 s-focus';

/** Create a promo code. Money fields are rupees in the form and paise on the wire. */
export function PromoForm({
  action,
  copy,
  errors,
  nowLocal,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  copy: PromoCopy;
  errors: Readonly<Record<string, string>>;
  nowLocal: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const id = useId();
  const c = copy.create;
  if (state.ok) return <Notice tone="success">{c.created}</Notice>;
  const field = (name: string, label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <label className="text-sm font-medium text-ink" htmlFor={`${id}-${name}`}>
      {label}
      <input id={`${id}-${name}`} name={name} className={input} {...props} />
      {hint ? <span className="mt-1 block text-xs font-normal text-slate">{hint}</span> : null}
    </label>
  );
  return (
    <form action={run} className="grid grid-cols-2 gap-4 xl:grid-cols-3" aria-label={c.title}>
      {state.code ? (
        <div className="col-span-full">
          <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice>
        </div>
      ) : null}
      {field('code', c.code, { required: true, pattern: '[A-Za-z0-9]{4,20}', maxLength: 20 }, c.codeHint)}
      {field('description', c.description, { required: true, minLength: 3, maxLength: 120 })}
      {field('descriptionTe', c.descriptionTe, { required: true, minLength: 3, maxLength: 120, lang: 'te' })}
      <label className="text-sm font-medium text-ink" htmlFor={`${id}-kind`}>
        {c.kind}
        <select id={`${id}-kind`} name="kind" className={`${input} bg-white`} defaultValue="flat">
          <option value="flat">{c.flat}</option>
          <option value="percent">{c.percent}</option>
        </select>
      </label>
      {field('value', c.value, { required: true, inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' }, c.valueHint)}
      {field('maxDiscount', c.maxDiscount, { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}
      {field('minOrder', c.minOrder, { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}
      {field('budget', c.budget, { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' }, c.budgetHint)}
      {field('perUser', c.perUser, { type: 'number', min: 1, max: 100, defaultValue: 1 })}
      {field('merchantShare', c.merchantShare, { type: 'number', min: 0, max: 100, defaultValue: 0 })}
      <label className="text-sm font-medium text-ink" htmlFor={`${id}-type`}>
        {c.types}
        <select id={`${id}-type`} name="type" className={`${input} bg-white`} defaultValue="">
          <option value="">{c.allTypes}</option>
          {Object.entries(copy.types).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {field('validFrom', c.validFrom, { type: 'datetime-local', defaultValue: nowLocal, required: true })}
      {field('validTo', c.validTo, { type: 'datetime-local' })}
      <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-ink" htmlFor={`${id}-first`}>
        <input id={`${id}-first`} name="firstOrder" type="checkbox" className="h-4 w-4 s-focus" />
        {c.firstOrder}
      </label>
      <div className="col-span-full">
        <button type="submit" disabled={pending} className="rounded-md bg-indigo px-5 py-2.5 text-sm font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60">
          {c.submit}
        </button>
      </div>
    </form>
  );
}
