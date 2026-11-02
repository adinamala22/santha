'use client';

import { useActionState, useId } from 'react';
import type { ActionState } from '@/components/admin/confirm-action';
import { Notice } from '@/components/admin/ui';

export interface EnrichCopy {
  add: string;
  name: string;
  brand: string;
  mrp: string;
  pack: string;
  packHint: string;
  category: string;
  added: string;
}

const input = 'mt-1 h-10 w-full rounded-md border border-indigo-100 px-3 s-focus';

/** Adds an unknown barcode to the master catalogue; later scans resolve to it. */
export function EnrichForm({
  action,
  copy,
  categories,
  errors,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  copy: EnrichCopy;
  categories: Array<{ slug: string; name: string }>;
  errors: Readonly<Record<string, string>>;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const id = useId();
  if (state.ok) return <Notice tone="success">{copy.added}</Notice>;
  return (
    <form action={run} className="grid grid-cols-2 gap-3">
      {state.code ? (
        <div className="col-span-2">
          <Notice tone="error">{errors[state.code] ?? errors.UNKNOWN}</Notice>
        </div>
      ) : null}
      <label className="col-span-2 text-sm font-medium text-ink" htmlFor={`${id}-name`}>
        {copy.name}
        <input id={`${id}-name`} name="name" required minLength={2} maxLength={120} className={input} />
      </label>
      <label className="text-sm font-medium text-ink" htmlFor={`${id}-brand`}>
        {copy.brand}
        <input id={`${id}-brand`} name="brand" maxLength={60} className={input} />
      </label>
      <label className="text-sm font-medium text-ink" htmlFor={`${id}-mrp`}>
        {copy.mrp}
        <input id={`${id}-mrp`} name="mrp" inputMode="decimal" pattern="\d+(\.\d{1,2})?" className={input} />
      </label>
      <label className="text-sm font-medium text-ink" htmlFor={`${id}-pack`}>
        {copy.pack}
        <input id={`${id}-pack`} name="pack" placeholder={copy.packHint} maxLength={30} className={input} />
      </label>
      <label className="text-sm font-medium text-ink" htmlFor={`${id}-cat`}>
        {copy.category}
        <select id={`${id}-cat`} name="category" required className={`${input} bg-white`}>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="col-span-2">
        <button type="submit" disabled={pending} className="rounded-md bg-indigo px-4 py-2 text-sm font-medium text-white s-focus hover:bg-indigo-700 disabled:opacity-60">
          {copy.add}
        </button>
      </div>
    </form>
  );
}
