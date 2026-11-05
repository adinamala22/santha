import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/csp';
import { BACKEND_URL, COOKIE, cookieOptions, isExpired } from './lib/ops/cookies';
import { serverConfig } from './lib/runtime-config';

/**
 * Every page: the Content-Security-Policy, built from the runtime settings (ADR-025).
 * /admin also: the session guard below.
 */
export async function middleware(req: NextRequest) {
  const res = req.nextUrl.pathname.startsWith('/admin') ? await adminGuard(req) : NextResponse.next();
  res.headers.set('Content-Security-Policy', contentSecurityPolicy(serverConfig(), process.env.NODE_ENV !== 'production'));
  return res;
}

/**
 * Guards /admin: a valid access token passes; an expired one is refreshed with the refresh cookie
 * (rotated tokens are written to the response AND forwarded to this request's server components);
 * otherwise the user is sent to /admin/login. The backend still authorises every call.
 */
async function adminGuard(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/admin/login')) return NextResponse.next();

  const access = req.cookies.get(COOKIE.access)?.value;
  if (!isExpired(access)) return NextResponse.next();

  const refresh = req.cookies.get(COOKIE.refresh)?.value;
  const deviceId = req.cookies.get(COOKIE.device)?.value;
  const toLogin = () => {
    const url = new URL('/admin/login', req.url);
    if (pathname !== '/admin') url.searchParams.set('next', pathname + search);
    const res = NextResponse.redirect(url);
    res.cookies.delete(COOKIE.access);
    res.cookies.delete(COOKIE.refresh);
    return res;
  };
  if (!refresh || !deviceId) return toLogin();

  let tokens: { accessToken: string; refreshToken: string; accessExpiresIn: number; refreshExpiresIn: number };
  try {
    const r = await fetch(`${BACKEND_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh, deviceId }),
    });
    if (!r.ok) return toLogin();
    tokens = await r.json();
  } catch {
    return toLogin();
  }

  // Forward the new access token to this request, and store both for the next ones.
  const headers = new Headers(req.headers);
  const others = req.cookies
    .getAll()
    .filter((c) => c.name !== COOKIE.access && c.name !== COOKIE.refresh)
    .map((c) => `${c.name}=${c.value}`);
  headers.set('cookie', [...others, `${COOKIE.access}=${tokens.accessToken}`, `${COOKIE.refresh}=${tokens.refreshToken}`].join('; '));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(COOKIE.access, tokens.accessToken, cookieOptions(tokens.accessExpiresIn));
  res.cookies.set(COOKIE.refresh, tokens.refreshToken, cookieOptions(tokens.refreshExpiresIn));
  return res;
}

// Pages only: not Next's static assets or image optimiser.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
