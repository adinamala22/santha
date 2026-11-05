import { NextResponse, type NextRequest } from 'next/server';
import { BACKEND_URL, COOKIE, cookieOptions, newDeviceId } from '@/lib/ops/cookies';

const YEAR = 365 * 24 * 3600;

/**
 * Step 1: email + password → backend sends the OTP; returns where it was sent (masked). Before launch prod may run
 * the console on password only (OPS_LOGIN_OTP=off, ADR-024): then the session comes back at once and is stored here.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const deviceId = req.cookies.get(COOKIE.device)?.value ?? newDeviceId();
  let r: Response;
  try {
    r = await fetch(`${BACKEND_URL}/v1/auth/ops/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
      body: JSON.stringify({ email: body.email, password: body.password, deviceId }),
    });
  } catch {
    return NextResponse.json({ error: { code: 'NETWORK', message: 'Could not reach Santha' } }, { status: 502 });
  }
  const json = await r.json().catch(() => null);
  if (r.ok && json?.signedIn && json.accessToken) {
    const done = NextResponse.json({ signedIn: true });
    done.cookies.set(COOKIE.access, json.accessToken, cookieOptions(json.accessExpiresIn));
    done.cookies.set(COOKIE.refresh, json.refreshToken, cookieOptions(json.refreshExpiresIn));
    done.cookies.set(COOKIE.device, deviceId, cookieOptions(YEAR));
    return done;
  }
  const res = NextResponse.json(
    r.ok ? { challengeId: json.challengeId, phoneMasked: json.phoneMasked, channel: json.channel } : json,
    { status: r.ok ? 200 : r.status },
  );
  res.cookies.set(COOKIE.device, deviceId, cookieOptions(YEAR));
  return res;
}
