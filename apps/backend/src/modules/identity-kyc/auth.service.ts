import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { maskPhone } from '../../common/pii';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SmsProvider, type SmsLocale } from '../../infra/providers/sms/sms.provider';
import { normalizeIndianMobile } from './domain/phone';
import { SIGNUP_ROLE, type SignupApp } from './domain/roles';
import {
  formatRefreshToken,
  generateOtpCode,
  hashOtp,
  hashRefreshSecret,
  newRefreshSecret,
  parseRefreshToken,
  safeEqual,
} from './domain/secrets';
import { IdentityRepository, type UserRecord } from './identity.repository';
import { RateLimiter } from './rate-limiter';
import { TokenService } from './token.service';

export interface OtpRequestInput {
  phone: string;
  deviceId: string;
  app: SignupApp;
  locale?: SmsLocale | undefined;
  ip: string;
}

export interface OtpVerifyInput {
  challengeId: string;
  code: string;
  deviceId: string;
  app: SignupApp;
  platform: Platform;
  appVersion?: string | undefined;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthResult extends TokenPair {
  user: UserRecord;
  isNewUser: boolean;
}

const HOUR = 3600;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: IdentityRepository,
    private readonly tokens: TokenService,
    private readonly sms: SmsProvider,
    private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async requestOtp(input: OtpRequestInput): Promise<{ challengeId: string; expiresInSec: number; resendAfterSec: number }> {
    const phone = normalizeIndianMobile(input.phone);
    const now = this.clock();

    const last = await this.repo.lastChallengeAt(phone);
    const cooldownLeft = last
      ? Math.ceil((last.getTime() + this.env.OTP_RESEND_COOLDOWN_SEC * 1000 - now.getTime()) / 1000)
      : 0;
    if (cooldownLeft > 0) throw this.rateLimited(cooldownLeft);

    for (const [key, limit] of [
      [`otp:phone:${phone}`, this.env.OTP_LIMIT_PER_PHONE_HOUR],
      [`otp:device:${input.deviceId}`, this.env.OTP_LIMIT_PER_DEVICE_HOUR],
      [`otp:ip:${input.ip}`, this.env.OTP_LIMIT_PER_IP_HOUR],
    ] as const) {
      const r = await this.limiter.hit(key, limit, HOUR);
      if (!r.allowed) throw this.rateLimited(r.retryAfterSec);
    }

    const challengeId = randomUUID();
    const code = this.env.OTP_PROVIDER === 'mock' && this.env.MOCK_OTP_CODE ? this.env.MOCK_OTP_CODE : generateOtpCode();
    await this.repo.createChallenge({
      id: challengeId,
      phone,
      deviceId: input.deviceId,
      app: input.app,
      codeHash: hashOtp(this.tokens.pepper, challengeId, code),
      expiresAt: new Date(now.getTime() + this.env.OTP_TTL_SEC * 1000),
    });

    try {
      await this.sms.sendOtp(phone, code, input.locale ?? 'en');
    } catch (err) {
      this.logger.error({ err, phone: maskPhone(phone), provider: this.sms.name }, 'OTP send failed');
      throw err instanceof DomainError
        ? err
        : new DomainError('PROVIDER_UNAVAILABLE', 'We could not send the code. Please try again.');
    }

    return { challengeId, expiresInSec: this.env.OTP_TTL_SEC, resendAfterSec: this.env.OTP_RESEND_COOLDOWN_SEC };
  }

  async verifyOtp(input: OtpVerifyInput): Promise<AuthResult> {
    const now = this.clock();
    const challenge = await this.repo.findChallenge(input.challengeId);
    if (!challenge || challenge.consumedAt || challenge.deviceId !== input.deviceId || challenge.app !== input.app)
      throw new DomainError('OTP_INVALID', 'That code is not valid. Request a new one.');
    if (challenge.expiresAt <= now) throw new DomainError('OTP_EXPIRED', 'That code has expired. Request a new one.');
    if (challenge.attempts >= this.env.OTP_MAX_ATTEMPTS)
      throw new DomainError('OTP_TOO_MANY_ATTEMPTS', 'Too many wrong attempts. Request a new code.');

    const attempts = await this.repo.incrementAttempts(challenge.id);
    if (!safeEqual(hashOtp(this.tokens.pepper, challenge.id, input.code), challenge.codeHash)) {
      const remaining = Math.max(0, this.env.OTP_MAX_ATTEMPTS - attempts);
      throw new DomainError('OTP_INVALID', 'That code is not right. Please check and try again.', {
        remainingAttempts: remaining,
      });
    }

    const sessionId = randomUUID();
    const refreshSecret = newRefreshSecret();
    const refreshExpiresAt = new Date(now.getTime() + this.tokens.refreshTtlSec * 1000);
    const role = SIGNUP_ROLE[input.app];

    const { user, isNewUser } = await this.repo.transaction(async (tx) => {
      if (!(await tx.consumeChallenge(challenge.id, now)))
        throw new DomainError('OTP_INVALID', 'That code is not valid. Request a new one.');

      let user = await tx.findUserByPhone(challenge.phone);
      const isNewUser = !user;
      if (!user) {
        user = await tx.createUser(challenge.phone);
        await tx.appendEvent({
          type: 'user.registered',
          aggregate: { type: 'user', id: user.id },
          actor: { type: 'user', id: user.id },
          payload: { user_id: user.id, app: input.app },
        });
      }
      if (user.status !== 'active') throw new DomainError('ACCOUNT_BLOCKED', 'This account is not active. Contact support.');

      if (await tx.grantRole(user.id, role, null)) {
        user = { ...user, roles: [...user.roles, role] };
        await tx.appendEvent({
          type: 'user.role_granted',
          aggregate: { type: 'user', id: user.id },
          actor: { type: 'user', id: user.id },
          payload: { user_id: user.id, role, granted_by: null },
        });
      }

      const device = await tx.upsertDevice(
        { userId: user.id, deviceId: input.deviceId, app: input.app, platform: input.platform, appVersion: input.appVersion },
        now,
      );
      await tx.createSession({
        id: sessionId,
        userId: user.id,
        deviceRowId: device.id,
        refreshHash: hashRefreshSecret(this.tokens.pepper, refreshSecret),
        expiresAt: refreshExpiresAt,
      });
      return { user, isNewUser };
    });

    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      roles: user.roles,
      did: input.deviceId,
      sid: sessionId,
      app: input.app,
    });
    return {
      accessToken,
      refreshToken: formatRefreshToken(sessionId, refreshSecret),
      accessExpiresIn: this.tokens.accessTtlSec,
      refreshExpiresIn: this.tokens.refreshTtlSec,
      user,
      isNewUser,
    };
  }

  /**
   * Rotates the refresh token. Re-use of the previous secret means the token leaked (or the
   * client refreshed twice concurrently — clients must single-flight refresh): revoke the session.
   */
  async refresh(refreshToken: string, deviceId: string): Promise<TokenPair> {
    const now = this.clock();
    const invalid = () => new DomainError('REFRESH_INVALID', 'Your session has expired. Please sign in again.');
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) throw invalid();

    const session = await this.repo.findSession(parsed.sessionId);
    if (!session || session.revokedAt || session.expiresAt <= now) throw invalid();
    if (session.deviceInstallId !== deviceId)
      throw new DomainError('DEVICE_MISMATCH', 'This session belongs to another device. Please sign in again.');

    const presented = hashRefreshSecret(this.tokens.pepper, parsed.secret);
    if (session.prevRefreshHash && safeEqual(presented, session.prevRefreshHash)) {
      await this.repo.revokeSession(session.id, 'refresh_reuse', now);
      this.logger.warn({ sessionId: session.id, userId: session.userId }, 'Refresh token reuse detected; session revoked');
      throw invalid();
    }
    if (!safeEqual(presented, session.refreshHash)) throw invalid();
    if (session.user.status !== 'active') {
      await this.repo.revokeSession(session.id, 'account_inactive', now);
      throw new DomainError('ACCOUNT_BLOCKED', 'This account is not active. Contact support.');
    }

    const nextSecret = newRefreshSecret();
    const expiresAt = new Date(now.getTime() + this.tokens.refreshTtlSec * 1000);
    const rotated = await this.repo.rotateSession(
      session.id,
      session.refreshHash,
      hashRefreshSecret(this.tokens.pepper, nextSecret),
      expiresAt,
      now,
    );
    if (!rotated) throw invalid();

    const accessToken = await this.tokens.signAccess({
      sub: session.userId,
      roles: session.user.roles,
      did: deviceId,
      sid: session.id,
      app: session.app,
    });
    return {
      accessToken,
      refreshToken: formatRefreshToken(session.id, nextSecret),
      accessExpiresIn: this.tokens.accessTtlSec,
      refreshExpiresIn: this.tokens.refreshTtlSec,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.revokeSession(sessionId, 'logout', this.clock());
  }

  async me(userId: string): Promise<UserRecord> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new DomainError('NOT_FOUND', 'Account not found');
    return user;
  }

  private rateLimited(retryAfterSec: number): DomainError {
    return new DomainError('RATE_LIMITED', 'Too many requests. Please wait and try again.', { retryAfterSec });
  }
}
