import type { ApiError } from '@santha/shared-types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message?: string };

/** Minimal JSON client. Errors come back as values; the UI maps codes to en/te copy. */
export async function postJson<T>(path: string, body: unknown, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      ...init,
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
  if (res.ok) return { ok: true, data: (res.status === 204 ? undefined : await res.json()) as T };
  // Proxies/CDNs may return non-Santha bodies; never assume the envelope is present.
  const err = (await res.json().catch(() => null)) as Partial<ApiError> | null;
  return { ok: false, status: res.status, code: err?.error?.code ?? 'HTTP_ERROR', message: err?.error?.message };
}
