import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

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
