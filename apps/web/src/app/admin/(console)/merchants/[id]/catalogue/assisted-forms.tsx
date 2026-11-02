'use client';

import { useActionState, useId, useState } from 'react';
import type { ActionState } from '@/components/admin/confirm-action';
import { Notice } from '@/components/admin/ui';
import type { CatalogueCopy } from '@/i18n/catalogue';
import type { ImportState } from '../../../catalogue/actions';

const input = 'mt-1 h-10 w-full rounded-md border border-indigo-100 bg-white px-3 s-focus';
const UNITS = ['pc', 'g', 'kg', 'ml', 'l', 'pack', 'portion'] as const;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

/** One item for the merchant's approval (FR-CAT-3). Price ≤ MRP and category rules are checked by the API. */
export function AssistedItemForm({
  action,
  copy,
  categories,
  errors,
  sellsFood,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  copy: CatalogueCopy['assisted'];
  categories: Array<{ slug: string; name: string }>;
  errors: Readonly<Record<string, string>>;
  sellsFood: boolean;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const id = useId();
  return (
    <form action={run} className="grid grid-cols-2 gap-3">
      {state.ok ? (
        <div className="col-span-2">
          <Notice tone="success">{copy.created}</Notice>
        </div>
      ) : state.code ? (
        <div className="col-span-2">
          <Notice tone="error">{state.message && state.code === 'VALIDATION_FAILED' ? state.message : (errors[state.code] ?? errors.UNKNOWN)}</Notice>
        </div>
      ) : null}
      <label htmlFor={`${id}-n`} className="col-span-2 text-sm font-medium text-ink">
        {copy.name}
        <input id={`${id}-n`} name="name" required minLength={2} maxLength={120} className={input} />
      </label>
      <label htmlFor={`${id}-te`} className="col-span-2 text-sm font-medium text-ink">
        {copy.nameTe}
        <input id={`${id}-te`} name="nameTe" lang="te" maxLength={120} className={input} />
      </label>
      <label htmlFor={`${id}-c`} className="text-sm font-medium text-ink">
        {copy.category}
        <select id={`${id}-c`} name="category" required className={input}>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-f`} className="text-sm font-medium text-ink">
        {copy.foodMark}
        <select id={`${id}-f`} name="foodMark" defaultValue={sellsFood ? 'veg' : 'none'} className={input}>
          {(['none', 'veg', 'non_veg', 'egg'] as const).map((f) => (
            <option key={f} value={f}>
              {copy.foodMarks[f]}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-s`} className="text-sm font-medium text-ink">
        {copy.size}
        <input id={`${id}-s`} name="size" placeholder={copy.sizeHint} maxLength={40} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label htmlFor={`${id}-q`} className="text-sm font-medium text-ink">
          {copy.qty}
          <input id={`${id}-q`} name="qty" type="number" min={0.001} step="any" defaultValue={1} className={input} />
        </label>
        <label htmlFor={`${id}-u`} className="text-sm font-medium text-ink">
          {copy.unit}
          <select id={`${id}-u`} name="unit" className={input}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor={`${id}-p`} className="text-sm font-medium text-ink">
        {copy.price}
        <input id={`${id}-p`} name="price" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" className={input} />
      </label>
      <label htmlFor={`${id}-m`} className="text-sm font-medium text-ink">
        {copy.mrp}
        <input id={`${id}-m`} name="mrp" inputMode="decimal" pattern="\d+(\.\d{1,2})?" className={input} />
      </label>
      <div className="col-span-2">
        <button type="submit" disabled={pending} className="rounded-md bg-indigo px-5 py-2 font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60">
          {copy.create}
        </button>
      </div>
    </form>
  );
}

/** Paste a merchant's list (WhatsApp/Excel → CSV): check it first, then add it for approval. */
export function AssistedImportForm({
  action,
  copy,
  errors,
}: {
  action: (prev: ImportState, form: FormData) => Promise<ImportState>;
  copy: CatalogueCopy['assisted'];
  errors: Readonly<Record<string, string>>;
}) {
  const [state, run, pending] = useActionState<ImportState, FormData>(action, { ok: false });
  // Controlled: React resets uncontrolled fields after every form action, and the list must survive "Check list".
  const [csv, setCsv] = useState('name,category,size,unit,qty,price,mrp\n');
  const id = useId();
  const r = state.report;
  return (
    <form action={run} className="space-y-3">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {copy.import}
      </label>
      <p className="text-sm text-slate">{copy.importHint}</p>
      <textarea
        id={id}
        name="csv"
        required
        rows={6}
        spellCheck={false}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        className="w-full rounded-md border border-indigo-100 px-3 py-2 font-mono text-sm s-focus"
      />
      {state.code ? <Notice tone="error">{state.message && state.code === 'VALIDATION_FAILED' ? state.message : (errors[state.code] ?? errors.UNKNOWN)}</Notice> : null}
      {r ? (
        r.dryRun ? (
          <div className="space-y-2">
            <Notice tone={r.rejected.length ? 'error' : 'info'}>{fill(copy.report, { ok: r.items.length, bad: r.rejected.length })}</Notice>
            {r.rejected.length ? (
              <ul className="space-y-1 text-sm text-chilli">
                {r.rejected.map((x) => (
                  <li key={x.line}>
                    {fill(copy.line, { line: x.line })}: {x.reasons.join('; ')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <Notice tone="success">{fill(copy.imported, { n: r.created })}</Notice>
        )
      ) : null}
      <div className="flex gap-3">
        <button type="submit" name="mode" value="check" disabled={pending} className="rounded-md border border-indigo-100 bg-white px-5 py-2 font-medium text-indigo s-focus disabled:opacity-60">
          {copy.check}
        </button>
        {r?.dryRun && r.items.length ? (
          <button type="submit" name="mode" value="import" disabled={pending} className="rounded-md bg-indigo px-5 py-2 font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60">
            {fill(copy.importNow, { n: r.items.length })}
          </button>
        ) : null}
      </div>
    </form>
  );
}
