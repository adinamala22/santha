'use client';

import { FormEvent, useId, useState } from 'react';
import { postJson } from '@/lib/api';
import type { Messages } from '@/i18n/messages';

type Step = 'credentials' | 'otp';
type Copy = Messages['admin'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorFor(code: string, status: number, copy: Copy): string {
  if (code === 'NETWORK') return copy.errors.network;
  if (status === 404) return copy.errors.unavailable; // backend ops login lands in M1
  if (status === 401) return copy.errors.credentials;
  return copy.errors.unavailable;
}

/**
 * Ops sign-in: email + password, then a one-time code (second factor).
 * Backend: POST /v1/auth/ops/login → { challengeId }, POST /v1/auth/ops/verify → httpOnly session cookie.
 * The endpoints are implemented in M1 (with NextAuth); until then the form reports "not available".
 */
export function LoginForm({ copy }: { copy: Copy }) {
  const ids = { email: useId(), password: useId(), otp: useId(), error: useId() };
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError(copy.errors.emailInvalid);
    if (!password) return setError(copy.errors.passwordRequired);
    setError(null);
    setBusy(true);
    const r = await postJson<{ challengeId: string }>('/v1/auth/ops/login', { email: email.trim(), password });
    setBusy(false);
    if (!r.ok) return setError(errorFor(r.code, r.status, copy));
    setChallengeId(r.data.challengeId);
    setStep('otp');
  }

  async function submitOtp(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setError(copy.errors.otpInvalid);
    setError(null);
    setBusy(true);
    const r = await postJson('/v1/auth/ops/verify', { challengeId, code: otp });
    setBusy(false);
    if (!r.ok) return setError(errorFor(r.code, r.status, copy));
    window.location.assign('/admin');
  }

  const inputCls =
    'mt-2 block h-14 w-full rounded-md border border-indigo-100 bg-sky/40 px-5 text-base text-ink placeholder:text-slate s-focus';
  const errorBox = error ? (
    <p id={ids.error} role="alert" className="mt-4 text-sm text-chilli">
      {error}
    </p>
  ) : null;

  if (step === 'otp') {
    return (
      <form onSubmit={submitOtp} noValidate aria-describedby={error ? ids.error : undefined}>
        <h1 className="text-4xl font-bold text-indigo">{copy.otpTitle}</h1>
        <p className="mt-2 text-slate">{copy.otpSub}</p>
        <label htmlFor={ids.otp} className="mt-10 block text-sm font-medium text-ink">
          {copy.otpLabel}
        </label>
        <input
          id={ids.otp}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          className={`${inputCls} tracking-[0.5em]`}
        />
        {errorBox}
        <button
          type="submit"
          disabled={busy}
          className="mt-8 h-14 w-full rounded-lg bg-indigo text-lg font-medium text-white hover:bg-indigo-700 disabled:opacity-60 s-focus"
        >
          {busy ? copy.submitting : copy.verify}
        </button>
        <button type="button" onClick={() => setStep('credentials')} className="mt-6 text-sm font-medium text-indigo s-focus">
          {copy.back}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} noValidate aria-describedby={error ? ids.error : undefined}>
      <h1 className="text-4xl font-bold text-indigo">{copy.signIn}</h1>
      <p className="mt-2 text-slate">{copy.signInSub}</p>

      <label htmlFor={ids.email} className="mt-10 block text-sm font-medium text-ink">
        {copy.email}
      </label>
      <input
        id={ids.email}
        type="email"
        autoComplete="username"
        placeholder="name@santha.in"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={inputCls}
      />

      <label htmlFor={ids.password} className="mt-6 block text-sm font-medium text-ink">
        {copy.password}
      </label>
      <input
        id={ids.password}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputCls}
      />

      {errorBox}

      <button
        type="submit"
        disabled={busy}
        className="mt-10 h-14 w-full rounded-lg bg-indigo text-lg font-medium text-white hover:bg-indigo-700 disabled:opacity-60 s-focus"
      >
        {busy ? copy.submitting : copy.continue}
      </button>
      <p className="mt-8 text-sm text-slate">{copy.otpNote}</p>
      <p className="mt-6 text-sm font-medium text-indigo">
        <a href="mailto:ops@santha.in?subject=Password%20reset" className="s-focus hover:underline">
          {copy.forgot}
        </a>
        {' · '}
        <a href="mailto:ops@santha.in?subject=Access%20request" className="s-focus hover:underline">
          {copy.requestAccess}
        </a>
      </p>
    </form>
  );
}
