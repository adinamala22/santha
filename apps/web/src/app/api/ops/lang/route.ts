import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE } from '@/lib/ops/cookies';

/** Switches the console language (en/te) and returns to the page. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const lang = form.get('lang') === 'te' ? 'te' : 'en';
  const back = String(form.get('back') ?? '/admin');
  const res = NextResponse.redirect(new URL(back.startsWith('/admin') ? back : '/admin', req.url), { status: 303 });
  res.cookies.set(COOKIE.lang, lang, { path: '/', maxAge: 365 * 24 * 3600, sameSite: 'lax' });
  return res;
}
