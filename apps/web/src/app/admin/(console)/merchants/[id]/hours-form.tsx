'use client';

import { useActionState, useState } from 'react';
import { Notice } from '@/components/admin/ui';
import { type ConsoleCopy, errorText } from '@/i18n/console';
import { type DecisionState, setHours } from './actions';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];
type Range = { open: string; close: string };
export type WeeklyHours = Record<Day, Range[]>;

const input = 'rounded-md border border-indigo-100 px-2 py-1 s-focus disabled:opacity-50';

/** Ops: a store's opening hours per day (ADR-021), with a reason for the audit log. */
export function HoursForm({
  id,
  hours,
  openNow,
  canEdit,
  copy,
}: {
  id: string;
  hours: WeeklyHours | null;
  openNow: boolean | null;
  canEdit: boolean;
  copy: ConsoleCopy;
}) {
  const k = copy.merchant.hoursEdit;
  const [state, submit, pending] = useActionState<DecisionState, FormData>(setHours.bind(null, id), { ok: false });
  return (
    <form action={submit} className="space-y-3" data-testid="hours-form">
      <p className="text-sm text-slate">{k.hint}</p>
      {openNow != null ? (
        <p className="text-sm font-medium text-ink" data-testid="hours-open-now">
          {k.openNow.replace('{state}', openNow ? k.open : k.shut)}
        </p>
      ) : null}
      {state.ok ? <Notice tone="success">{k.saved}</Notice> : null}
      {!state.ok && state.code ? <Notice tone="error">{errorText(copy, state.code)}</Notice> : null}
      <fieldset disabled={!canEdit || pending} className="space-y-2">
        {/* Keyed by the saved week: after a save (React resets the form) the rows start again from what was stored. */}
        <DayRows key={JSON.stringify(hours)} hours={hours} copy={copy} />
        <label className="block text-sm text-ink">
          {k.reason}
          <input name="reason" type="text" minLength={3} maxLength={200} required className={`mt-1 w-full ${input} px-3 py-2`} />
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

function DayRows({ hours, copy }: { hours: WeeklyHours | null; copy: ConsoleCopy }) {
  const k = copy.merchant.hoursEdit;
  const [closed, setClosed] = useState<Record<Day, boolean>>(() => Object.fromEntries(DAYS.map((d) => [d, !!hours && !hours[d]?.length])) as Record<Day, boolean>);
  // A day that is closed today opens with the store's usual hours when ops untick "Closed".
  const usual: Range = DAYS.map((d) => hours?.[d]?.[0]).find((r): r is Range => !!r) ?? { open: '09:00', close: '21:00' };
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate">
          <th className="py-1 font-normal" />
          <th className="py-1 font-normal">{k.opens}</th>
          <th className="py-1 font-normal">{k.closes}</th>
          <th className="py-1 font-normal">{k.closed}</th>
        </tr>
      </thead>
      <tbody>
        {DAYS.map((d) => {
          const r = hours?.[d]?.[0] ?? usual;
          const label = copy.markets.days[d];
          return (
            <tr key={d}>
              <th scope="row" className="py-1 pr-2 text-left font-medium text-ink">
                {label}
              </th>
              <td className="py-1 pr-2">
                <input name={`${d}-open`} type="time" aria-label={`${label} ${k.opens}`} defaultValue={r.open} disabled={closed[d]} required={!closed[d]} className={input} />
              </td>
              <td className="py-1 pr-2">
                <input name={`${d}-close`} type="time" aria-label={`${label} ${k.closes}`} defaultValue={r.close} disabled={closed[d]} required={!closed[d]} className={input} />
              </td>
              <td className="py-1">
                <input
                  name={`${d}-closed`}
                  type="checkbox"
                  aria-label={`${label} ${k.closed}`}
                  defaultChecked={closed[d]}
                  onChange={(e) => setClosed((c) => ({ ...c, [d]: e.target.checked }))}
                  className="s-focus"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
