/**
 * Ops console session cookies (all httpOnly — tokens never reach browser JavaScript). Shared by the
 * middleware (edge) and server code, so this file must stay dependency-free. See ADR-007.
 */
export const COOKIE = {
  access: 'santha_ops_at',
  refresh: 'santha_ops_rt',
  device: 'santha_ops_did',
  lang: 'santha_ops_lang',
} as const;

export const BACKEND_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const cookieOptions = (maxAgeSec: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: maxAgeSec,
});

export interface AccessClaims {
  sub: string;
  roles: string[];
  exp: number;
}

/** Reads (does not verify) the access JWT payload — the backend verifies on every call. */
export function readClaims(token: string | undefined): AccessClaims | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const p = JSON.parse(json) as Partial<AccessClaims>;
    return typeof p.sub === 'string' && typeof p.exp === 'number' ? { sub: p.sub, roles: p.roles ?? [], exp: p.exp } : null;
  } catch {
    return null;
  }
}

/** True if the token is missing or expires within `skewSec`. */
export const isExpired = (token: string | undefined, nowSec = Date.now() / 1000, skewSec = 30) => {
  const c = readClaims(token);
  return !c || c.exp - skewSec <= nowSec;
};

export const newDeviceId = () => `web-${crypto.randomUUID()}`;
