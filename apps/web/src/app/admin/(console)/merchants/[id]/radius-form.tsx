'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/admin/ui';
import { type ConsoleCopy, errorText } from '@/i18n/console';
import { type DecisionState, setRadius } from './actions';

/** Ops: how far the store delivers (500 m – 10 km), with a reason for the audit log. */
export function RadiusForm({ id, radiusM, canEdit, copy }: { id: string; radiusM: number; canEdit: boolean; copy: ConsoleCopy }) {
  const k = copy.merchant.radiusEdit;
  const [state, submit, pending] = useActionState<DecisionState, FormData>(setRadius.bind(null, id), { ok: false });
  const input = 'mt-1 w-full rounded-md border border-indigo-100 px-3 py-2 s-focus';
  return (
    <form action={submit} className="space-y-3" data-testid="radius-form">
      <p className="text-sm text-slate">{k.hint}</p>
      {state.ok ? <Notice tone="success">{k.saved}</Notice> : null}
      {!state.ok && state.code ? <Notice tone="error">{errorText(copy, state.code)}</Notice> : null}
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        <label className="block text-sm text-ink">
          {k.km}
          <input name="km" type="number" min={0.5} max={10} step={0.5} defaultValue={radiusM / 1000} required className={input} />
        </label>
        <label className="block text-sm text-ink">
          {k.reason}
          <input name="reason" type="text" minLength={3} maxLength={200} required className={input} />
        </label>
        {canEdit ? (
          <button type="submit" className="rounded-md bg-indigo px-5 py-2 font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-50">
            {k.save}
          </button>
        ) : null}
      </fieldset>
    </form>
  );
}
