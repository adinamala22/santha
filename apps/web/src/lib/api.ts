import type { ApiError } from '@santha/shared-types';

import { publicConfig, serverConfig } from './runtime-config';

/** The API as browsers reach it (runtime setting, ADR-025). */
export const apiUrl = (): string => publicConfig().apiUrl;

/** Server-side calls: inside the server's network when API_URL is set (compose: http://api:4000), else the public address. */
export const serverApiUrl = (): string => (typeof process !== 'undefined' && process.env['API_URL']) || serverConfig().apiUrl;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message?: string };

/** Minimal JSON client. Errors come back as values; the UI maps codes to en/te copy. */
export async function postJson<T>(path: string, body: unknown, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
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
