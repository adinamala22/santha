'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/admin/ui';
import { type ConsoleCopy, errorText, fill } from '@/i18n/console';
import { type CoverageState, saveCoverage } from './actions';

/** City-wide coverage switch (ADR-019): serve addresses outside every micro-market from the nearest one. */
export function CoverageForm({
  cityId,
  cityName,
  coverage,
  canEdit,
  copy,
}: {
  cityId: string;
  cityName: string;
  coverage: { nearestFallback: boolean; maxDistanceM: number };
  canEdit: boolean;
  copy: ConsoleCopy;
}) {
  const k = copy.markets.coverage;
  const [state, submit, pending] = useActionState<CoverageState, FormData>(saveCoverage.bind(null, cityId), { ok: false });
  const status = coverage.nearestFallback ? fill(k.statusOn, { km: coverage.maxDistanceM / 1000 }) : k.statusOff;
  return (
    <form action={submit} className="space-y-3" data-testid="coverage-form">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-indigo">
          {k.title} · {cityName}
        </h2>
        <span className={coverage.nearestFallback ? 'text-sm font-medium text-leaf' : 'text-sm text-slate'}>{status}</span>
      </div>
      <p className="text-sm text-slate">{k.hint}</p>
      {state.ok ? <Notice tone="success">{k.saved}</Notice> : null}
      {!state.ok && state.code ? <Notice tone="error">{errorText(copy, state.code)}</Notice> : null}
      <fieldset disabled={!canEdit || pending} className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" name="nearestFallback" defaultChecked={coverage.nearestFallback} className="h-5 w-5 accent-indigo" /> {k.on}
        </label>
        <label className="text-sm text-ink">
          {k.km}
          <input
            name="maxKm"
            type="number"
            min={0.5}
            max={50}
            step={0.5}
            defaultValue={coverage.maxDistanceM / 1000}
            className="ml-2 w-24 rounded-md border border-indigo-100 px-3 py-2 s-focus"
          />
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
