'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import type { ActionState } from '@/components/admin/confirm-action';
import { Notice } from '@/components/admin/ui';

/** Reply box with ready replies (macros) that can be edited before sending. Clears after a reply is sent. */
export function ReplyForm({
  action,
  macros,
  copy,
  errors,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  macros: Readonly<Record<string, string>>;
  copy: { replyLabel: string; replyHint: string; macroLabel: string; macroNone: string; send: string; sent: string };
  errors: Readonly<Record<string, string>>;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const box = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={run} className="space-y-3" data-testid="support-reply">
      {state.ok ? <Notice tone="success">{copy.sent}</Notice> : null}
      {!state.ok && state.code ? <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice> : null}
      <label htmlFor={`${id}-macro`} className="block text-sm font-medium text-ink">
        {copy.macroLabel}
      </label>
      <select
        id={`${id}-macro`}
        defaultValue=""
        onChange={(e) => {
          if (box.current && e.target.value) box.current.value = macros[e.target.value] ?? '';
          e.target.value = '';
          box.current?.focus();
        }}
        className="h-10 w-full rounded-md border border-indigo-100 bg-white px-3 s-focus"
      >
        <option value="">{copy.macroNone}</option>
        {Object.entries(macros).map(([k, v]) => (
          <option key={k} value={k}>
            {v.length > 70 ? `${v.slice(0, 67)}…` : v}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-body`} className="block text-sm font-medium text-ink">
        {copy.replyLabel}
      </label>
      <textarea ref={box} id={`${id}-body`} name="body" required maxLength={1000} rows={4} placeholder={copy.replyHint} className="w-full rounded-md border border-indigo-100 p-3 s-focus" />
      <button type="submit" disabled={pending} className="rounded-md bg-indigo px-5 py-2 font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60">
        {copy.send}
      </button>
    </form>
  );
}
