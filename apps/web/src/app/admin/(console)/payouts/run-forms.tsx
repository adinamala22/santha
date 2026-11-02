'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/components/admin/confirm-action';
import { Notice } from '@/components/admin/ui';

const field = 'mt-1 h-10 rounded-md border border-indigo-100 bg-white px-3 s-focus';
const button = 'h-10 rounded-pill bg-indigo px-5 font-medium text-white s-focus disabled:opacity-60';

/** Run a settlement for a kind and an IST date. */
export function RunSettlementForm({
  action,
  copy,
  errors,
  today,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  copy: { kind: string; kinds: Record<string, string>; date: string; runButton: string; ran: string };
  errors: Readonly<Record<string, string>>;
  today: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  return (
    <form action={run} aria-label={copy.runButton} className="flex flex-wrap items-end gap-4">
      <label className="block text-sm font-medium text-ink">
        {copy.kind}
        <select name="kind" defaultValue="merchant" className={`${field} block`}>
          {Object.entries(copy.kinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-ink">
        {copy.date}
        <input type="date" name="date" defaultValue={today} required className={`${field} block`} />
      </label>
      <button type="submit" disabled={pending} className={button}>
        {copy.runButton}
      </button>
      {state.ok ? <Notice tone="success">{copy.ran}</Notice> : state.code ? <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice> : null}
    </form>
  );
}

/** Reconcile captured payments for an IST date against the gateway report. */
export function ReconForm({
  action,
  copy,
  errors,
  today,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  copy: { reconRun: string; date: string; reconDone: string };
  errors: Readonly<Record<string, string>>;
  today: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  return (
    <form action={run} aria-label={copy.reconRun} className="flex flex-wrap items-end gap-4">
      <label className="block text-sm font-medium text-ink">
        {copy.date}
        <input type="date" name="date" defaultValue={today} required className={`${field} block`} />
      </label>
      <button type="submit" disabled={pending} className={button}>
        {copy.reconRun}
      </button>
      {state.ok ? <Notice tone="success">{copy.reconDone}</Notice> : state.code ? <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice> : null}
    </form>
  );
}
