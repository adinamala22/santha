'use client';

import { useActionState, useId, useState } from 'react';
import { Notice } from '@/components/admin/ui';
import { type ConsoleCopy, errorText, fill } from '@/i18n/console';
import { decide, type DecisionState } from './actions';

type Action = 'approve' | 'reject' | 'go-live';

const REASONS = ['kyc_mismatch', 'fssai_invalid', 'documents_unclear', 'outside_serviceable_area', 'restricted_category', 'duplicate_merchant', 'other'] as const;

/**
 * Approve / send back / go live, each behind a confirm step (santha-web: destructive actions need
 * confirmation). Which buttons appear depends on the status; the backend re-checks everything.
 */
export function DecisionPanel({
  id,
  name,
  market,
  status,
  canDecide,
  copy,
}: {
  id: string;
  name: string;
  market: string;
  status: string;
  canDecide: boolean;
  copy: ConsoleCopy;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decide.bind(null, id), { ok: false });
  const [confirming, setConfirming] = useState<Action | null>(null);
  const ids = { note: useId(), reason: useId() };
  const c = copy.merchant;

  const available: Action[] = status === 'submitted' ? ['approve', 'reject'] : status === 'approved' ? ['go-live', 'reject'] : [];
  if (!canDecide) return <Notice>{copy.common.readOnly}</Notice>;
  if (!available.length) return <p className="text-slate">{c.noActions}</p>;

  const label = (a: Action) => (a === 'approve' ? c.approve : a === 'reject' ? c.reject : c.goLive);
  const question = (a: Action) =>
    fill(a === 'approve' ? c.confirmApprove : a === 'reject' ? c.confirmReject : c.confirmGoLive, { name, market });

  return (
    <form action={action} className="space-y-4">
      {state.ok ? <Notice tone="success">{c.done}</Notice> : null}
      {!state.ok && state.code ? <Notice tone="error">{errorText(copy, state.code)}</Notice> : null}

      {confirming === 'reject' ? (
        <div>
          <label htmlFor={ids.reason} className="block text-sm font-medium text-ink">
            {c.reason}
          </label>
          <select id={ids.reason} name="reasonCode" defaultValue="documents_unclear" className="mt-1 h-11 w-full rounded-md border border-indigo-100 bg-white px-3 s-focus">
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {c.reasons[r]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div>
        <label htmlFor={ids.note} className="block text-sm font-medium text-ink">
          {c.note}
        </label>
        <textarea id={ids.note} name="note" rows={2} maxLength={500} className="mt-1 w-full rounded-md border border-indigo-100 px-3 py-2 s-focus" />
      </div>

      {confirming ? (
        <div className="rounded-md border border-marigold bg-marigold-100 p-4">
          <p className="text-ink">{question(confirming)}</p>
          <input type="hidden" name="action" value={confirming} />
          <div className="mt-3 flex gap-3">
            <button
              type="submit"
              disabled={pending}
              onClick={() => setTimeout(() => setConfirming(null), 0)}
              className="rounded-md bg-indigo px-5 py-2 font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60"
            >
              {copy.common.confirm}
            </button>
            <button type="button" onClick={() => setConfirming(null)} className="rounded-md border border-indigo-100 bg-white px-5 py-2 text-indigo s-focus">
              {copy.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {available.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setConfirming(a)}
              className={
                a === 'reject'
                  ? 'rounded-md border border-chilli px-5 py-3 font-medium text-chilli s-focus hover:bg-chilli/10'
                  : a === 'go-live'
                    ? 'rounded-md bg-marigold px-5 py-3 font-medium text-ink s-focus hover:bg-marigold-600'
                    : 'rounded-md bg-indigo px-5 py-3 font-medium text-white s-focus hover:bg-indigo-700'
              }
            >
              {label(a)}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
