import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/** 6-digit numeric OTP from a CSPRNG. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** OTP hash is bound to the challenge id, so a code is useless against any other challenge. */
export function hashOtp(pepper: string, challengeId: string, code: string): string {
  return createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('base64url');
}

export function hashRefreshSecret(pepper: string, secret: string): string {
  return createHmac('sha256', pepper).update(secret).digest('base64url');
}

export function newRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Refresh token wire format: `<sessionId>.<secret>`. */
export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const i = token.indexOf('.');
  if (i <= 0 || i === token.length - 1) return null;
  const sessionId = token.slice(0, i);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  return { sessionId, secret: token.slice(i + 1) };
}

// ── ops console passwords (scrypt, per-password salt) ──
const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;

/** `scrypt$N$r$p$<salt b64url>$<hash b64url>` — parameters stored so they can be raised later. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
