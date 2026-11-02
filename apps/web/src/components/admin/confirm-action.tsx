'use client';

import { useActionState, useId, useState } from 'react';
import { Notice } from '@/components/admin/ui';

export interface ActionState {
  ok: boolean;
  code?: string;
  message?: string;
  /** The decision that succeeded (selects the success message). */
  done?: string;
}

export interface ConfirmChoice {
  value: string;
  label: string;
  question: string;
  tone?: 'primary' | 'danger';
}

/**
 * A row of decision buttons, each behind a confirm step (santha-web: actions that change what
 * customers see need confirmation). Posts `decision` plus an optional note to a server action.
 */
export function ConfirmAction({
  action,
  choices,
  noteLabel,
  doneText,
  errors,
  confirmText,
  cancelText,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  choices: ConfirmChoice[];
  noteLabel?: string;
  /** Success message per decision value. */
  doneText: Readonly<Record<string, string>>;
  /** Error code → message in the console language; must contain UNKNOWN. */
  errors: Readonly<Record<string, string>>;
  confirmText: string;
  cancelText: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const [confirming, setConfirming] = useState<ConfirmChoice | null>(null);
  const noteId = useId();

  if (state.ok) return <Notice tone="success">{doneText[state.done ?? ''] ?? Object.values(doneText)[0]}</Notice>;

  return (
    <form action={run} className="space-y-3">
      {!state.ok && state.code ? <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice> : null}
      {noteLabel && confirming ? (
        <div>
          <label htmlFor={noteId} className="block text-sm font-medium text-ink">
            {noteLabel}
          </label>
          <input id={noteId} name="note" maxLength={300} className="mt-1 h-10 w-full rounded-md border border-indigo-100 px-3 s-focus" />
        </div>
      ) : null}
      {confirming ? (
        <div className="rounded-md border border-marigold bg-marigold-100 p-3">
          <p className="text-sm text-ink">{confirming.question}</p>
          <input type="hidden" name="decision" value={confirming.value} />
          <div className="mt-2 flex gap-2">
            <button type="submit" disabled={pending} className="rounded-md bg-indigo px-4 py-2 text-sm font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60">
              {confirmText}
            </button>
            <button type="button" onClick={() => setConfirming(null)} className="rounded-md border border-indigo-100 bg-white px-4 py-2 text-sm text-indigo s-focus">
              {cancelText}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setConfirming(c)}
              className={
                c.tone === 'danger'
                  ? 'rounded-md border border-chilli px-4 py-2 text-sm font-medium text-chilli s-focus hover:bg-chilli/10'
                  : 'rounded-md bg-indigo px-4 py-2 text-sm font-medium text-white s-focus hover:bg-indigo-700'
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
