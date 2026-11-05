'use client';

import Image from 'next/image';
import { type FormEvent, useId, useState } from 'react';
import { siteMessages } from '@/i18n/site';
import { postJson } from '@/lib/api';

const CATEGORIES = ['kirana', 'supermarket', 'fruits_vegetables', 'pharmacy', 'bakery', 'dairy', 'meat_fish', 'fashion', 'electronics', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Store sign-up (ADR-023): shop name and type, with a live preview of the card customers will see in the
 * app (name, type · area, "New on Santha", 30–45 min). Saved as a `store` lead (POST /v1/leads).
 */
export function StoreLeadForm({ lang, prelaunch = true }: { lang: 'en' | 'te'; prelaunch?: boolean }) {
  const c = siteMessages[lang].storeLaunch;
  const f = siteMessages[lang].form;
  const id = useId();
  const [shop, setShop] = useState('');
  const [category, setCategory] = useState<Category>('kirana');
  const [area, setArea] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const phone = String(data.get('phone') ?? '').replace(/\D/g, '').slice(-10);
    if (shop.trim().length < 2) return setError(c.errorBusiness);
    if (name.length < 2) return setError(f.errorName);
    if (!/^[6-9]\d{9}$/.test(phone)) return setError(f.errorPhone);
    setError(null);
    setState('sending');
    const r = await postJson('/v1/leads', {
      kind: 'store',
      name,
      phone,
      business: shop.trim(),
      category,
      area: area.trim() || undefined,
      locale: lang,
      website: String(data.get('website') ?? '') || undefined,
    });
    if (r.ok) return setState('done');
    setState('idle');
    setError(r.code === 'RATE_LIMITED' ? f.rateLimited : f.error);
  }

  const preview = (
    <figure aria-label={c.previewTitle} data-testid="shop-preview" className="rounded-xl bg-cream p-5">
      <figcaption className="text-sm font-medium text-slate">{c.previewTitle}</figcaption>
      <div className="mt-3 flex gap-4 rounded-lg border-[1.5px] border-indigo-100 bg-white p-3 shadow-sm">
        <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[10px] bg-indigo">
          <Image src="/brand/santha-mark.svg" alt="" width={32} height={40} className="h-10 w-auto" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-medium text-ink" data-testid="preview-name">
            {shop.trim() || c.previewName}
          </p>
          <p className="truncate text-sm text-slate" data-testid="preview-meta">
            {c.categories[category]} · {area.trim() || c.previewArea}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-pill bg-eta px-3 py-0.5 text-sm font-medium text-leaf">{c.previewEta}</span>
            <span className="rounded-pill bg-indigo-100 px-3 py-0.5 text-sm font-medium text-indigo">{c.previewNew}</span>
          </div>
        </div>
      </div>
    </figure>
  );

  if (state === 'done')
    return (
      <div className="space-y-5">
        {preview}
        <p role="status" className="rounded-lg bg-eta p-6 text-lg font-medium text-leaf" data-testid="lead-thanks">
          {prelaunch ? c.thanks : f.thanks}
        </p>
      </div>
    );

  const input = 'mt-1 h-12 w-full rounded-md border border-indigo-100 bg-white px-4 text-base s-focus';
  return (
    <div className="space-y-5">
      {preview}
      <form onSubmit={submit} aria-label={prelaunch ? c.formTitle : f.title} className="space-y-4" noValidate>
        <h2 className="text-2xl font-bold text-indigo">{prelaunch ? c.formTitle : f.title}</h2>
        <label htmlFor={`${id}-shop`} className="block text-sm font-medium text-ink">
          {c.business}
          <input id={`${id}-shop`} name="business" value={shop} onChange={(e) => setShop(e.target.value)} maxLength={80} required className={input} />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-ink">{c.category}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORIES.map((k) => (
              <label
                key={k}
                className={`cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marigold rounded-pill border px-4 py-2 text-sm ${category === k ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-ink hover:border-indigo'}`}
              >
                <input type="radio" name="category" value={k} checked={category === k} onChange={() => setCategory(k)} className="sr-only" />
                {c.categories[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor={`${id}-name`} className="block text-sm font-medium text-ink">
          {f.name}
          <input id={`${id}-name`} name="name" autoComplete="name" required maxLength={80} className={input} />
        </label>
        <label htmlFor={`${id}-phone`} className="block text-sm font-medium text-ink">
          {f.phone}
          <input id={`${id}-phone`} name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" required className={input} />
        </label>
        <label htmlFor={`${id}-area`} className="block text-sm font-medium text-ink">
          {f.area}
          <input id={`${id}-area`} name="area" value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} className={input} />
        </label>
        {/* Honeypot: visually hidden and skipped by keyboard users and screen readers. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-chilli">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={state === 'sending'} className="s-focus h-14 w-full rounded-pill bg-marigold px-6 text-lg font-bold text-indigo hover:bg-marigold-600 disabled:opacity-60">
          {state === 'sending' ? f.sending : prelaunch ? c.submit : f.submit}
        </button>
        <p className="text-center text-sm text-slate">{c.free}</p>
      </form>
    </div>
  );
}
