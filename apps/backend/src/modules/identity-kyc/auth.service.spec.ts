import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryIdentityRepository, InMemoryRateLimiter } from '../../../test/mocks/in-memory-identity.repository';
import { DomainError } from '../../common/errors/domain-error';
import { parseEnv, type Env } from '../../config/env';
import { MockSmsProvider } from '../../infra/providers/sms/sms.provider';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

const PHONE = '98765 43210';
const E164 = '+919876543210';
const DEVICE = 'device-install-0001';

function setup(overrides: Record<string, string> = {}) {
  const env: Env = parseEnv({ ...process.env, ...overrides });
  let now = new Date('2026-11-01T10:00:00Z');
  const clock = () => now;
  const repo = new InMemoryIdentityRepository();
  repo.clock = clock;
  const limiter = new InMemoryRateLimiter();
  const sms = new MockSmsProvider();
  const tokens = new TokenService(new JwtService({}), env);
  const auth = new AuthService(repo, tokens, sms, limiter, env, clock);
  return {
    env,
    repo,
    limiter,
    sms,
    tokens,
    auth,
    advance: (sec: number) => {
      now = new Date(now.getTime() + sec * 1000);
    },
  };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

async function login(ctx: ReturnType<typeof setup>, app: 'consumer' | 'merchant' | 'rider' = 'consumer') {
  const { challengeId } = await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app, ip: '1.2.3.4' });
  const code = ctx.sms.lastCodeFor(E164)!;
  return ctx.auth.verifyOtp({ challengeId, code, deviceId: DEVICE, app, platform: 'android' });
}

describe('AuthService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  describe('requestOtp', () => {
    it('normalises the phone, stores a hashed code and sends the SMS', async () => {
      const r = await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: '1.2.3.4' });
      expect(r).toEqual({ challengeId: expect.any(String), expiresInSec: 300, resendAfterSec: 30 });
      const c = ctx.repo.challenges.get(r.challengeId)!;
      expect(c.phone).toBe(E164);
      const code = ctx.sms.lastCodeFor(E164)!;
      expect(code).toMatch(/^\d{6}$/);
      expect(c.codeHash).not.toContain(code);
    });

    it('rejects invalid phone numbers', async () => {
      await expectCode(ctx.auth.requestOtp({ phone: '12345', deviceId: DEVICE, app: 'consumer', ip: 'x' }), 'INVALID_PHONE');
    });

    it('enforces the resend cooldown', async () => {
      await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' });
      await expectCode(ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' }), 'RATE_LIMITED');
      ctx.advance(31);
      await expect(ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' })).resolves.toBeTruthy();
    });

    it('rate-limits per phone', async () => {
      for (let i = 0; i < ctx.env.OTP_LIMIT_PER_PHONE_HOUR; i++) {
        await ctx.auth.requestOtp({ phone: PHONE, deviceId: `${DEVICE}-${i}`, app: 'consumer', ip: `ip${i}` });
        ctx.advance(31);
      }
      await expectCode(ctx.auth.requestOtp({ phone: PHONE, deviceId: 'other-device-1', app: 'consumer', ip: 'z' }), 'RATE_LIMITED');
    });

    it('uses MOCK_OTP_CODE when configured with the mock provider', async () => {
      const c = setup({ MOCK_OTP_CODE: '123456' });
      await c.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' });
      expect(c.sms.lastCodeFor(E164)).toBe('123456');
    });
  });

  describe('verifyOtp', () => {
    it('creates the user with the app role, emits events and returns device-bound tokens', async () => {
      const r = await login(ctx);
      expect(r.isNewUser).toBe(true);
      expect(r.user.phone).toBe(E164);
      expect(r.user.roles).toEqual(['consumer']);
      expect(ctx.repo.events.map((e) => e.type)).toEqual(['user.registered', 'user.role_granted']);
      const claims = await ctx.tokens.verifyAccess(r.accessToken);
      expect(claims).toMatchObject({ sub: r.user.id, roles: ['consumer'], did: DEVICE, app: 'consumer' });
      expect(r.refreshToken.startsWith(claims.sid)).toBe(true);
    });

    it('adds a second role when the same phone signs in to another app, without re-registering', async () => {
      await login(ctx, 'consumer');
      ctx.advance(31);
      const r = await login(ctx, 'rider');
      expect(r.isNewUser).toBe(false);
      expect(r.user.roles.sort()).toEqual(['consumer', 'rider']);
      expect(ctx.repo.events.map((e) => e.type)).toEqual(['user.registered', 'user.role_granted', 'user.role_granted']);
    });

    it('never self-grants ops roles', async () => {
      const r = await login(ctx, 'merchant');
      expect(r.user.roles).toEqual(['merchant']);
    });

    it('rejects a wrong code and counts attempts, then locks the challenge', async () => {
      const { challengeId } = await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' });
      const right = ctx.sms.lastCodeFor(E164)!;
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < ctx.env.OTP_MAX_ATTEMPTS; i++)
        await expectCode(ctx.auth.verifyOtp({ challengeId, code: wrong, deviceId: DEVICE, app: 'consumer', platform: 'android' }), 'OTP_INVALID');
      await expectCode(
        ctx.auth.verifyOtp({ challengeId, code: right, deviceId: DEVICE, app: 'consumer', platform: 'android' }),
        'OTP_TOO_MANY_ATTEMPTS',
      );
    });

    it('rejects expired codes', async () => {
      const { challengeId } = await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' });
      ctx.advance(301);
      await expectCode(
        ctx.auth.verifyOtp({ challengeId, code: ctx.sms.lastCodeFor(E164)!, deviceId: DEVICE, app: 'consumer', platform: 'android' }),
        'OTP_EXPIRED',
      );
    });

    it('binds the challenge to the requesting device and app', async () => {
      const { challengeId } = await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' });
      const code = ctx.sms.lastCodeFor(E164)!;
      await expectCode(ctx.auth.verifyOtp({ challengeId, code, deviceId: 'another-device', app: 'consumer', platform: 'android' }), 'OTP_INVALID');
      await expectCode(ctx.auth.verifyOtp({ challengeId, code, deviceId: DEVICE, app: 'rider', platform: 'android' }), 'OTP_INVALID');
    });

    it('a code cannot be used twice', async () => {
      const { challengeId } = await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'consumer', ip: 'x' });
      const code = ctx.sms.lastCodeFor(E164)!;
      await ctx.auth.verifyOtp({ challengeId, code, deviceId: DEVICE, app: 'consumer', platform: 'android' });
      await expectCode(ctx.auth.verifyOtp({ challengeId, code, deviceId: DEVICE, app: 'consumer', platform: 'android' }), 'OTP_INVALID');
    });

    it('rolls back (challenge stays unconsumed, no events) when the account is blocked', async () => {
      await login(ctx);
      const user = [...ctx.repo.users.values()][0]!;
      user.status = 'blocked';
      ctx.advance(31);
      const eventsBefore = ctx.repo.events.length;
      const { challengeId } = await ctx.auth.requestOtp({ phone: PHONE, deviceId: DEVICE, app: 'rider', ip: 'x' });
      await expectCode(
        ctx.auth.verifyOtp({ challengeId, code: ctx.sms.lastCodeFor(E164)!, deviceId: DEVICE, app: 'rider', platform: 'android' }),
        'ACCOUNT_BLOCKED',
      );
      expect(ctx.repo.challenges.get(challengeId)!.consumedAt).toBeNull();
      expect(ctx.repo.events.length).toBe(eventsBefore);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token', async () => {
      const r = await login(ctx);
      const next = await ctx.auth.refresh(r.refreshToken, DEVICE);
      expect(next.refreshToken).not.toBe(r.refreshToken);
      const again = await ctx.auth.refresh(next.refreshToken, DEVICE);
      expect(again.accessToken).toBeTruthy();
    });

    it('revokes the session when an old refresh token is replayed', async () => {
      const r = await login(ctx);
      const next = await ctx.auth.refresh(r.refreshToken, DEVICE);
      await expectCode(ctx.auth.refresh(r.refreshToken, DEVICE), 'REFRESH_INVALID');
      await expectCode(ctx.auth.refresh(next.refreshToken, DEVICE), 'REFRESH_INVALID');
    });

    it('rejects refresh from a different device without revoking', async () => {
      const r = await login(ctx);
      await expectCode(ctx.auth.refresh(r.refreshToken, 'stolen-device-01'), 'DEVICE_MISMATCH');
      await expect(ctx.auth.refresh(r.refreshToken, DEVICE)).resolves.toBeTruthy();
    });

    it('rejects expired sessions and garbage tokens', async () => {
      const r = await login(ctx);
      await expectCode(ctx.auth.refresh('not-a-token', DEVICE), 'REFRESH_INVALID');
      ctx.advance(ctx.env.JWT_REFRESH_TTL_SEC + 1);
      await expectCode(ctx.auth.refresh(r.refreshToken, DEVICE), 'REFRESH_INVALID');
    });

    it('logout revokes the session', async () => {
      const r = await login(ctx);
      const { sid } = await ctx.tokens.verifyAccess(r.accessToken);
      await ctx.auth.logout(sid);
      await expectCode(ctx.auth.refresh(r.refreshToken, DEVICE), 'REFRESH_INVALID');
    });
  });
});
