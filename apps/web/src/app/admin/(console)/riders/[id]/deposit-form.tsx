'use client';

import { useActionState, useId } from 'react';
import { Notice } from '@/components/admin/ui';
import type { ActionState } from '@/components/admin/confirm-action';

/** Record cash the rider handed over (ADR-032): amount in rupees and a note; the API audits it. */
export function DepositForm({
  action,
  copy,
  errors,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  copy: { amount: string; note: string; record: string; done: string };
  errors: Readonly<Record<string, string>>;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const ids = { amount: useId(), note: useId() };
  return (
    <form action={run} className="space-y-3" data-testid="deposit-form">
      {state.ok ? <Notice tone="success">{copy.done}</Notice> : null}
      {!state.ok && state.code ? <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice> : null}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={ids.amount} className="block text-sm font-medium text-ink">
            {copy.amount}
          </label>
          <input id={ids.amount} name="amount" type="number" min={1} step="0.01" required className="mt-1 h-10 w-full rounded-md border border-indigo-100 px-3 s-focus" />
        </div>
        <div>
          <label htmlFor={ids.note} className="block text-sm font-medium text-ink">
            {copy.note}
          </label>
          <input id={ids.note} name="note" maxLength={300} className="mt-1 h-10 w-full rounded-md border border-indigo-100 px-3 s-focus" />
        </div>
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-indigo px-4 py-2 text-sm font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60">
        {copy.record}
      </button>
    </form>
  );
}
