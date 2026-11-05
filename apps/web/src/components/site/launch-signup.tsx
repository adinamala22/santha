'use client';

import { type FormEvent, useId, useState } from 'react';
import { siteMessages } from '@/i18n/site';
import { postJson } from '@/lib/api';

/**
 * "Tell me when it launches" (ADR-023): a customer launch-list sign-up on the landing page while the apps are not
 * in the stores yet. Saved as a `customer` lead (POST /v1/leads; honeypot + rate limit as the other lead forms).
 */
export function LaunchSignup({ lang }: { lang: 'en' | 'te' }) {
  const p = siteMessages[lang].prelaunch;
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
    const r = await postJson('/v1/leads', { kind: 'customer', name, phone, locale: lang, website: String(data.get('website') ?? '') || undefined });
    if (r.ok) return setState('done');
    setState('idle');
    setError(r.code === 'RATE_LIMITED' ? f.rateLimited : f.error);
  }

  if (state === 'done')
    return (
      <p role="status" data-testid="launch-thanks" className="rounded-lg bg-white/10 p-5 text-lg font-medium text-white">
        {p.thanks}
      </p>
    );

  const input = 'h-12 w-full rounded-pill border-0 bg-white px-5 text-base text-ink placeholder:text-slate s-focus';
  return (
    <form onSubmit={submit} aria-label={p.formTitle} noValidate className="rounded-xl bg-white/10 p-5">
      <h2 className="text-lg font-bold text-white">{p.formTitle}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label htmlFor={`${id}-name`} className="sr-only">
          {p.name}
        </label>
        <input id={`${id}-name`} name="name" autoComplete="name" maxLength={80} placeholder={p.name} className={input} />
        <label htmlFor={`${id}-phone`} className="sr-only">
          {p.phone}
        </label>
        <input id={`${id}-phone`} name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder={p.phone} className={input} />
        <button type="submit" disabled={state === 'sending'} className="s-focus h-12 rounded-pill bg-marigold px-6 font-medium text-indigo hover:bg-marigold-600 disabled:opacity-60">
          {state === 'sending' ? p.sending : p.submit}
        </button>
      </div>
      {/* Honeypot: hidden from people, keyboard users and screen readers. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-3 font-medium text-marigold">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-sm text-ondarkmuted">{p.formNote}</p>
      )}
    </form>
  );
}
