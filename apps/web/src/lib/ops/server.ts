import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Locale } from '@/i18n/messages';
import { BACKEND_URL, COOKIE, readClaims } from './cookies';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

export interface OpsSession {
  userId: string;
  roles: string[];
  canDecide: boolean; // admin/ops may approve, reject, publish
}

export async function opsSession(): Promise<OpsSession | null> {
  const jar = await cookies();
  const c = readClaims(jar.get(COOKIE.access)?.value);
  return c ? { userId: c.sub, roles: c.roles, canDecide: c.roles.some((r) => r === 'admin' || r === 'ops') } : null;
}

export async function opsLocale(): Promise<Locale> {
  return (await cookies()).get(COOKIE.lang)?.value === 'te' ? 'te' : 'en';
}

/**
 * Calls the backend as the signed-in ops user (Authorization + X-Device-Id from the httpOnly
 * cookies). 401 → back to sign-in. Other errors come back as values for the UI to show.
 */
export async function opsApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const jar = await cookies();
  const token = jar.get(COOKIE.access)?.value;
  const deviceId = jar.get(COOKIE.device)?.value;
  if (!token || !deviceId) redirect('/admin/login');

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-device-id': deviceId,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', message: 'Could not reach the Santha API.' };
  }
  if (res.status === 401) redirect('/admin/login');
  if (res.ok) return { ok: true, data: (res.status === 204 ? undefined : await res.json()) as T };
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
  return {
    ok: false,
    status: res.status,
    code: body?.error?.code ?? 'HTTP_ERROR',
    message: body?.error?.message ?? `Request failed (${res.status})`,
    details: body?.error?.details,
  };
}

/** For pages: unwrap or render the error state via a thrown error (caught by error.tsx). */
export async function opsGet<T>(path: string): Promise<T> {
  const r = await opsApi<T>(path);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
}
