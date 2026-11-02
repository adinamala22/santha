'use client';

import type { JobView } from '@santha/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fill } from '@/i18n/console';
import { liveMessages } from '@/i18n/live';
import { API_URL, postJson } from '@/lib/api';
import { rupees } from '@/lib/format';

type Lang = 'en' | 'te';

/**
 * Self-delivery link for store staff (no app, no account; the token is the credential): pickup, live
 * location while delivering, and the customer's OTP at the door.
 */
export function StaffDelivery({ token }: { token: string }) {
  const [lang, setLang] = useState<Lang>('en');
  const c = liveMessages[lang].staff;
  const [job, setJob] = useState<JobView | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [cash, setCash] = useState('');
  const lastSent = useRef(0);

  const load = useCallback(async () => {
    const res = await fetch(`${API_URL}/v1/staff-jobs/${encodeURIComponent(token)}`).catch(() => null);
    if (!res) return setError(liveMessages[lang].staff.error);
    if (res.status === 404) return setInvalid(true);
    if (res.ok) {
      const j = (await res.json()) as JobView;
      setJob(j);
      setCash((v) => v || (j.codDuePaise ? String(j.codDuePaise / 100) : ''));
    }
  }, [token, lang]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.language.startsWith('te')) setLang('te');
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  // Share location while the order is with the staff member (assigned or on the way); stops at delivery.
  const sharing = job?.state === 'picked_up' || job?.state === 'assigned';
  useEffect(() => {
    if (!sharing || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastSent.current < 10_000) return;
        lastSent.current = Date.now();
        void postJson(`/v1/staff-jobs/${encodeURIComponent(token)}/location`, { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy });
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [sharing, token]);

  const act = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    const r = await postJson<JobView>(`/v1/staff-jobs/${encodeURIComponent(token)}/${path}`, body);
    setBusy(false);
    if (r.ok) setJob(r.data);
    else setError(r.code === 'WRONG_CODE' ? c.wrongCode : r.code === 'NOT_READY' ? c.notReady : c.error);
  };

  const toggle = (
    <button type="button" onClick={() => setLang(lang === 'en' ? 'te' : 'en')} className="text-sm text-marigold s-focus" lang={lang === 'en' ? 'te' : 'en'}>
      {lang === 'en' ? 'తెలుగు' : 'English'}
    </button>
  );

  if (invalid)
    return (
      <main lang={lang} className="mx-auto max-w-md p-6">
        <p className="text-chilli">{c.invalid}</p>
      </main>
    );
  if (!job)
    return (
      <main lang={lang} className="mx-auto max-w-md p-6 text-slate">
        …
      </main>
    );

  const input = 'mt-1 h-12 w-full rounded-md border border-indigo-100 px-3 text-lg s-focus';
  const primary = 'h-12 w-full rounded-pill bg-indigo font-semibold text-white s-focus disabled:opacity-50';
  return (
    <main lang={lang} className="mx-auto max-w-md space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{fill(c.title, { code: job.code })}</h1>
        {toggle}
      </div>
      <section className="rounded-lg bg-sky p-4">
        <p className="font-medium text-ink">{fill(c.store, { store: job.store.name })}</p>
        <p className="text-sm text-slate">{fill(c.items, { n: job.itemCount })}</p>
      </section>
      <section className="rounded-lg border border-indigo-100 p-4">
        <p className="text-sm text-slate">{c.drop}</p>
        <p className="font-medium text-ink" data-testid="drop">
          {[job.drop.name, job.drop.line, job.drop.landmark].filter(Boolean).join(', ')}
        </p>
        {job.instructions ? <p className="text-sm text-indigo">{fill(c.note, { text: String(job.instructions) })}</p> : null}
        <a href={`tel:${job.callNumber}`} className="mt-3 inline-block rounded-pill border border-indigo px-4 py-2 text-sm font-medium text-indigo s-focus">
          {c.call}
        </a>
      </section>
      {error ? (
        <p role="alert" className="text-chilli">
          {error}
        </p>
      ) : null}

      {job.state === 'delivered' ? (
        <p className="text-lg font-semibold text-leaf" data-testid="done">
          {c.done}
        </p>
      ) : job.state === 'assigned' ? (
        <>
          {job.orderState !== 'READY' ? <p className="text-marigold-600">{c.waitReady}</p> : null}
          <button type="button" disabled={busy} onClick={() => void act('picked-up')} className={primary}>
            {c.pickedUp}
          </button>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act('delivered', { otp, ...(job.codDuePaise ? { codCollectedPaise: Math.round(Number(cash) * 100) } : {}) });
          }}
        >
          <p className="text-sm text-slate">{c.shareLocation}</p>
          <label className="block">
            <span className="text-sm font-medium text-ink">{c.otp}</span>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" className={`${input} tracking-[0.5em]`} />
          </label>
          <div className="rounded-md bg-marigold-100 p-3">
            <p className="font-medium text-ink">{job.codDuePaise ? fill(c.cod, { amount: rupees(job.codDuePaise) }) : c.prepaid}</p>
            {job.codDuePaise ? (
              <label className="mt-2 block">
                <span className="text-sm text-ink">{c.cash}</span>
                <input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" className={input} />
              </label>
            ) : null}
          </div>
          <button type="submit" disabled={busy || otp.length !== 4} className={primary}>
            {c.delivered}
          </button>
        </form>
      )}
    </main>
  );
}
