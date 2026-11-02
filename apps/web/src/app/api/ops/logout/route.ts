import { NextResponse, type NextRequest } from 'next/server';
import { BACKEND_URL, COOKIE } from '@/lib/ops/cookies';

/** Revokes the backend session (best effort) and clears the cookies. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE.access)?.value;
  const deviceId = req.cookies.get(COOKIE.device)?.value;
  if (token && deviceId)
    await fetch(`${BACKEND_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-device-id': deviceId },
    }).catch(() => undefined);
  const res = NextResponse.redirect(new URL('/admin/login', req.url), { status: 303 });
  res.cookies.delete(COOKIE.access);
  res.cookies.delete(COOKIE.refresh);
  return res;
}
