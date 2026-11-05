'use client';

import type { MicroMarketVersion } from '@santha/shared-types';
import { useActionState, useId, useMemo, useState } from 'react';
import { PolygonMap, type Shape } from '@/components/admin/polygon-map';
import { Notice } from '@/components/admin/ui';
import { type ConsoleCopy, errorText, fill } from '@/i18n/console';
import { paiseToRupeeInput } from '@/lib/format';
import { circleRing, closeRing, openRing, type Position, ringProblems } from '@/lib/polygon-edit';
import { createMarket, type EditorState, publishVersion } from './actions';

type Config = Pick<MicroMarketVersion, 'polygon' | 'hours' | 'fees' | 'cod' | 'sla' | 'riderPay'>;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const input = 'mt-1 h-11 w-full rounded-md border border-indigo-100 bg-white px-3 text-ink s-focus';

function Field({ label, name, defaultValue, type = 'number', step, hint, optional = false }: { label: string; name: string; defaultValue: string | number; type?: string; step?: string; hint?: string; optional?: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input id={id} name={name} type={type} step={step} min={type === 'number' ? 0 : undefined} defaultValue={defaultValue} required={!optional} className={input} />
      {hint ? <p className="mt-1 text-xs text-slate">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-md border border-indigo-100 p-4">
      <legend className="px-2 font-medium text-indigo">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Centre + radius → the area's points (ADR-019). Starts at the middle of the current area. */
export function CircleTool({ copy, start, onApply }: { copy: ConsoleCopy['markets']['circle']; start: Position[]; onApply: (ring: Position[]) => void }) {
  const mid = start.length ? start.reduce((a, p) => [a[0] + p[0] / start.length, a[1] + p[1] / start.length] as Position, [0, 0] as Position) : ([79.9865, 14.4426] as Position);
  const [lat, setLat] = useState(mid[1].toFixed(5));
  const [lng, setLng] = useState(mid[0].toFixed(5));
  const [km, setKm] = useState('3');
  const [error, setError] = useState(false);
  const apply = () => {
    const c = { lat: Number(lat), lng: Number(lng) };
    const r = Number(km);
    const ok = Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180 && r >= 0.5 && r <= 25;
    setError(!ok);
    if (ok) onApply(circleRing(c, r * 1000));
  };
  const input = 'mt-1 w-full rounded-md border border-indigo-100 px-3 py-2 s-focus';
  return (
    <fieldset className="mt-4 rounded-lg border border-indigo-100 p-4" data-testid="circle-tool">
      <legend className="px-1 text-sm font-medium text-indigo">{copy.title}</legend>
      <p className="mb-3 text-sm text-slate">{copy.hint}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm text-ink">
          {copy.lat}
          <input className={input} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label className="text-sm text-ink">
          {copy.lng}
          <input className={input} inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
        </label>
        <label className="text-sm text-ink">
          {copy.km}
          <input className={input} inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={apply} className="w-full rounded-md bg-indigo px-4 py-2 font-medium text-white s-focus hover:bg-indigo-700">
            {copy.apply}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-chilli">
          {copy.invalid}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Edits a full micro-market config and publishes it as a new version (or creates the market with
 * version 1). Starts from `template` (the current version), shows neighbours on the map for
 * context; the backend checks shape, overlap and effective dates.
 */
export function VersionEditor({
  mode,
  marketId,
  template,
  neighbours,
  copy,
}: {
  mode: 'publish' | 'create';
  marketId?: string;
  template: Config;
  neighbours: Shape[];
  copy: ConsoleCopy;
}) {
  const k = copy.markets;
  const initial = useMemo(() => openRing(template.polygon.coordinates[0] as Position[]), [template]);
  const [ring, setRing] = useState<Position[]>(mode === 'create' ? [] : initial);
  const [history, setHistory] = useState<Position[][]>([]);
  const change = (next: Position[]) => {
    setHistory((h) => [...h.slice(-49), ring]);
    setRing(next);
  };
  const action = mode === 'create' ? createMarket : publishVersion.bind(null, marketId!);
  const [state, submit, pending] = useActionState<EditorState, FormData>(action, { ok: false });
  const problems = ringProblems(ring);

  return (
    <form action={submit} className="space-y-6">
      {state.ok && state.version ? <Notice tone="success">{fill(k.published, { v: state.version })}</Notice> : null}
      {!state.ok && state.code ? (
        <Notice tone="error">
          {errorText(copy, state.code)}
          {state.message && state.code === 'POLYGON_OVERLAP' ? ` (${state.message.replace(/^The area overlaps /, '')})` : ''}
        </Notice>
      ) : null}

      {mode === 'create' ? (
        <div className="grid gap-4 md:grid-cols-3">
          <input type="hidden" name="citySlug" value="nellore" />
          <Field label={k.slug} name="slug" type="text" defaultValue="" />
          <Field label={k.name} name="name" type="text" defaultValue="" />
          <Field label={k.nameTe} name="nameTe" type="text" defaultValue="" />
        </div>
      ) : null}

      <Section title={k.area}>
        <p className="mb-3 text-sm text-slate">{k.areaHint}</p>
        <PolygonMap shapes={neighbours} edit={{ ring, onChange: change }} unavailable={k.mapUnavailable} />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className={problems.length ? 'text-chilli' : 'text-leaf'}>{fill(k.points, { n: ring.length })}</span>
          <button type="button" disabled={!history.length} onClick={() => { setRing(history[history.length - 1]!); setHistory((h) => h.slice(0, -1)); }} className="rounded-md border border-indigo-100 px-3 py-1 text-indigo s-focus disabled:opacity-40">
            {k.undo}
          </button>
          <button type="button" onClick={() => change([])} className="rounded-md border border-indigo-100 px-3 py-1 text-indigo s-focus">
            {k.clear}
          </button>
          {mode === 'publish' ? (
            <button type="button" onClick={() => change(initial)} className="rounded-md border border-indigo-100 px-3 py-1 text-indigo s-focus">
              {k.reset}
            </button>
          ) : null}
        </div>
        <input type="hidden" name="polygon" value={JSON.stringify(closeRing(ring))} />
        <CircleTool copy={k.circle} start={ring} onApply={change} />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={k.fees}>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(k.feeFields) as Array<keyof typeof k.feeFields>).map((f) => (
              <Field key={f} label={k.feeFields[f]} name={`fees.${f}`} step="0.01" defaultValue={paiseToRupeeInput(template.fees[f] ?? (f === 'beyondRadiusSurchargePaise' ? 3000 : 0))} />
            ))}
          </div>
        </Section>
        <Section title={k.riderPay}>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(k.riderPayFields) as Array<keyof typeof k.riderPayFields>).map((f) => (
              <Field key={f} label={k.riderPayFields[f]} name={`riderPay.${f}`} step="0.01" defaultValue={paiseToRupeeInput(template.riderPay[f])} />
            ))}
          </div>
        </Section>
        <Section title={k.cod}>
          <label className="flex items-center gap-2 text-ink">
            <input type="checkbox" name="cod.enabled" defaultChecked={template.cod.enabled} className="h-5 w-5 accent-indigo" /> {k.codEnabled}
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={k.codMax} name="cod.maxOrderPaise" step="0.01" defaultValue={paiseToRupeeInput(template.cod.maxOrderPaise)} />
            <div>
              <p className="text-sm font-medium text-ink">{k.codTypes}</p>
              {(['retail', 'fashion'] as const).map((t) => (
                <label key={t} className="mt-2 flex items-center gap-2 text-ink">
                  <input type="checkbox" name={`cod.type.${t}`} defaultChecked={template.cod.allowedTypes.includes(t)} className="h-5 w-5 accent-indigo" /> {copy.types[t]}
                </label>
              ))}
            </div>
          </div>
        </Section>
        <Section title={k.sla}>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(k.slaFields) as Array<keyof typeof k.slaFields>).map((f) => (
              <Field key={f} label={k.slaFields[f]} name={`sla.${f}`} step="1" defaultValue={template.sla[f]} />
            ))}
          </div>
        </Section>
      </div>

      <Section title={k.hours}>
        <div className="grid gap-2">
          {DAYS.map((d) => {
            const r = template.hours[d][0];
            return (
              <div key={d} className="grid grid-cols-[5rem_1fr_1fr_8rem] items-center gap-3">
                <span className="font-medium text-ink">{k.days[d]}</span>
                <input aria-label={`${k.days[d]} open`} name={`hours.${d}.open`} type="time" defaultValue={r?.open ?? '07:00'} className={input} />
                <input aria-label={`${k.days[d]} close`} name={`hours.${d}.close`} type="time" defaultValue={r?.close ?? '22:00'} className={input} />
                <label className="flex items-center gap-2 text-sm text-slate">
                  <input type="checkbox" name={`hours.${d}.closed`} defaultChecked={!r} className="h-4 w-4 accent-indigo" /> {k.closed}
                </label>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={k.effectiveFrom} name="effectiveFrom" type="datetime-local" defaultValue="" hint={k.effectiveFromHint} optional />
        <Field label={k.note} name="note" type="text" defaultValue="" optional />
      </div>

      <button type="submit" disabled={pending || problems.length > 0} className="h-12 rounded-md bg-indigo px-8 font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-50">
        {mode === 'create' ? k.create : k.publish}
      </button>
    </form>
  );
}
