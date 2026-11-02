'use client';

import { type FormEvent, useId, useState } from 'react';
import { siteMessages } from '@/i18n/site';
import { postJson } from '@/lib/api';

type Kind = 'store' | 'home_kitchen' | 'rider';

/** Lead form → POST /v1/leads (honeypot field hidden from people; rate-limited by the backend). */
export function LeadForm({ kind, lang }: { kind: Kind; lang: 'en' | 'te' }) {
  const f = siteMessages[lang].form;
  const id = useId();
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const phone = String(data.get('phone') ?? '').replace(/\D/g, '').slice(-10);
    if (name.length < 2) return setError(f.errorName);
    if (!/^[6-9]\d{9}$/.test(phone)) return setError(f.errorPhone);
    setError(null);
    setState('sending');
    const r = await postJson('/v1/leads', {
      kind,
      name,
      phone,
      area: String(data.get('area') ?? '').trim() || undefined,
      message: String(data.get('message') ?? '').trim() || undefined,
      locale: lang,
      website: String(data.get('website') ?? '') || undefined,
    });
    if (r.ok) return setState('done');
    setState('idle');
    setError(r.code === 'RATE_LIMITED' ? f.rateLimited : f.error);
  }

  if (state === 'done')
    return (
      <p role="status" className="rounded-lg bg-eta p-6 text-lg font-medium text-leaf" data-testid="lead-thanks">
        {f.thanks}
      </p>
    );

  const input = 'mt-1 h-12 w-full rounded-md border border-indigo-100 bg-white px-4 text-base s-focus';
  return (
    <form onSubmit={submit} aria-label={f.title} className="space-y-4" noValidate>
      <h2 className="text-2xl font-bold text-indigo">{f.title}</h2>
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
        <input id={`${id}-area`} name="area" maxLength={80} className={input} />
      </label>
      <label htmlFor={`${id}-message`} className="block text-sm font-medium text-ink">
        {f.message}
        <textarea id={`${id}-message`} name="message" maxLength={500} rows={3} className={`${input} h-auto py-3`} />
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
      <button type="submit" disabled={state === 'sending'} className="s-focus h-12 w-full rounded-pill bg-indigo px-6 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {state === 'sending' ? f.sending : f.submit}
      </button>
    </form>
  );
}
