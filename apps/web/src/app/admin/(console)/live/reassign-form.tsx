'use client';

import { useActionState, useId, useState } from 'react';
import type { ActionState } from '@/components/admin/confirm-action';
import { Notice } from '@/components/admin/ui';

/** Pick an online rider, confirm, reassign. */
export function ReassignForm({
  action,
  riders,
  copy,
  errors,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  riders: Array<{ userId: string; name: string }>;
  copy: { reassign: string; chooseRider: string; noRidersOnline: string; /** Question with a {rider} placeholder. */ confirm: string; done: string; confirmText: string; cancelText: string };
  errors: Readonly<Record<string, string>>;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const [rider, setRider] = useState('');
  const [confirming, setConfirming] = useState(false);
  const id = useId();
  if (state.ok) return <Notice tone="success">{copy.done}</Notice>;
  if (riders.length === 0) return <p className="text-sm text-slate">{copy.noRidersOnline}</p>;
  const name = riders.find((r) => r.userId === rider)?.name ?? '';
  return (
    <form action={run} className="space-y-2">
      {state.code ? <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice> : null}
      <label htmlFor={id} className="sr-only">
        {copy.chooseRider}
      </label>
      <select
        id={id}
        name="riderUserId"
        value={rider}
        onChange={(e) => {
          setRider(e.target.value);
          setConfirming(false);
        }}
        className="h-9 rounded-md border border-indigo-100 bg-white px-2 text-sm s-focus"
      >
        <option value="">{copy.chooseRider}</option>
        {riders.map((r) => (
          <option key={r.userId} value={r.userId}>
            {r.name}
          </option>
        ))}
      </select>
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">{copy.confirm.replace('{rider}', name)}</p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="rounded-pill bg-indigo px-4 py-1.5 text-sm font-medium text-white s-focus disabled:opacity-60">
              {copy.confirmText}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-pill border border-indigo-100 px-4 py-1.5 text-sm text-indigo s-focus">
              {copy.cancelText}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={!rider} onClick={() => setConfirming(true)} className="ml-2 rounded-pill border border-indigo px-4 py-1.5 text-sm font-medium text-indigo s-focus disabled:opacity-40">
          {copy.reassign}
        </button>
      )}
    </form>
  );
}
