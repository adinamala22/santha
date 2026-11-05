import type { NextFunction, Request, Response } from 'express';

/**
 * Pre-launch mode (LAUNCH_STAGE=prelaunch, ADR-024): production serves only the public website and the ops
 * console. Everything the apps use (sign-in, cart, orders, payments, merchant and rider endpoints, realtime)
 * answers 503 PRELAUNCH "Santha is launching soon", so no live payments, KYC or SMS accounts are needed yet.
 */
const OPEN: Array<{ method?: string; path: RegExp }> = [
  { path: /^\/v1\/health(\/|$)/ },
  { method: 'GET', path: /^\/v1\/config\/site$/ },
  { method: 'POST', path: /^\/v1\/leads$/ },
  { method: 'GET', path: /^\/v1\/public\// },
  { method: 'GET', path: /^\/v1\/stores\/[^/]+$/ }, // store link pages (/s/…) read the store's items
  { method: 'GET', path: /^\/v1\/stores\/[^/]+\/reviews$/ },
  // Ops console: password sign-in (and OTP when it is on), its session, and the /ops API.
  { method: 'POST', path: /^\/v1\/auth\/ops\/(login|verify)$/ },
  { method: 'POST', path: /^\/v1\/auth\/(refresh|logout)$/ },
  { method: 'GET', path: /^\/v1\/me$/ },
  { path: /^\/v1\/ops(\/|$)/ },
];

export function prelaunchAllows(method: string, path: string): boolean {
  const p = path.split('?')[0]!;
  return OPEN.some((r) => (!r.method || r.method === method.toUpperCase()) && r.path.test(p));
}

export function prelaunchMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' || prelaunchAllows(req.method, req.originalUrl ?? req.url)) return next();
  res.status(503).json({ error: { code: 'PRELAUNCH', message: 'Santha is launching soon. The apps open on launch day.' } });
}
