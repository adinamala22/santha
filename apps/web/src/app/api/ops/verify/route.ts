import { NextResponse, type NextRequest } from 'next/server';
import { BACKEND_URL, COOKIE, cookieOptions } from '@/lib/ops/cookies';

/** Step 2: the OTP → session tokens stored in httpOnly cookies (never returned to the page). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { challengeId?: string; code?: string };
  const deviceId = req.cookies.get(COOKIE.device)?.value;
  if (!deviceId) return NextResponse.json({ error: { code: 'OTP_INVALID', message: 'Start again' } }, { status: 400 });
  let r: Response;
  try {
    r = await fetch(`${BACKEND_URL}/v1/auth/ops/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: body.challengeId, code: body.code, deviceId }),
    });
  } catch {
    return NextResponse.json({ error: { code: 'NETWORK', message: 'Could not reach Santha' } }, { status: 502 });
  }
  const json = await r.json().catch(() => null);
  if (!r.ok) return NextResponse.json(json, { status: r.status });
  const res = NextResponse.json({ ok: true, name: json.user?.name ?? null });
  res.cookies.set(COOKIE.access, json.accessToken, cookieOptions(json.accessExpiresIn));
  res.cookies.set(COOKIE.refresh, json.refreshToken, cookieOptions(json.refreshExpiresIn));
  return res;
}
