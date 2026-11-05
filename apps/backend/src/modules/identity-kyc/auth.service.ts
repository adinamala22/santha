import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppId, Platform } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { maskPhone } from '../../common/pii';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { SmsLocale } from '../../infra/providers/sms/sms.provider';
import { OtpDeliveryService, type OtpChannel } from './otp-delivery.service';
import { normalizeIndianMobile } from './domain/phone';
import { OPS_ROLES, SIGNUP_ROLE, type SignupApp } from './domain/roles';
import {
  formatRefreshToken,
  generateOtpCode,
  hashOtp,
  hashRefreshSecret,
  newRefreshSecret,
  parseRefreshToken,
  safeEqual,
  verifyPassword,
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

export interface OpsLoginInput {
  email: string;
  password: string;
  deviceId: string;
  ip: string;
}

export interface OpsVerifyInput {
  challengeId: string;
  code: string;
  deviceId: string;
}

/** Compared against when the email is unknown, so timing does not reveal which emails exist. */
const DUMMY_HASH = 'scrypt$16384$8$1$c2FudGhhLWR1bW15LXNhbHQ$0Ad0tK6d1Tqo3J2t6qHk0q8j3cM7h8iGQ9b3pZq1y0E';

const isOps = (roles: readonly string[]) => roles.some((r) => (OPS_ROLES as readonly string[]).includes(r));

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
    private readonly delivery: OtpDeliveryService,
    private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async requestOtp(input: OtpRequestInput): Promise<{ challengeId: string; expiresInSec: number; resendAfterSec: number; channel: OtpChannel }> {
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

    return this.issueChallenge(phone, input.deviceId, input.app, input.locale ?? 'en', now);
  }

  /** Every login OTP (apps and the ops console's second factor) goes through here: WhatsApp or SMS per OtpDeliveryService. */
  private async issueChallenge(phone: string, deviceId: string, app: AppId, locale: SmsLocale, now: Date) {
    const challengeId = randomUUID();
    const plan = await this.delivery.plan(deviceId);
    // The fixed test code only when nothing real can deliver it (all channels are mocks).
    const code = plan.allMock && this.env.MOCK_OTP_CODE ? this.env.MOCK_OTP_CODE : generateOtpCode();
    await this.repo.createChallenge({
      id: challengeId,
      phone,
      deviceId,
      app,
      codeHash: hashOtp(this.tokens.pepper, challengeId, code),
      expiresAt: new Date(now.getTime() + this.env.OTP_TTL_SEC * 1000),
    });

    let channel: OtpChannel;
    try {
      channel = await this.delivery.send(plan, phone, code, locale);
    } catch (err) {
      this.logger.error({ err, phone: maskPhone(phone), channels: plan.channels }, 'OTP send failed');
      throw err instanceof DomainError
        ? err
        : new DomainError('PROVIDER_UNAVAILABLE', 'We could not send the code. Please try again.');
    }

    return { challengeId, expiresInSec: this.env.OTP_TTL_SEC, resendAfterSec: this.env.OTP_RESEND_COOLDOWN_SEC, channel };
  }

  /**
   * Ops console step 1: email + password. On success an OTP goes to the phone on the account
   * (second factor). Errors never reveal whether the email exists. Only accounts holding an ops
   * role can sign in; ops roles are granted by an admin, never self-service.
   */
  async opsLogin(input: OpsLoginInput) {
    const email = input.email.trim().toLowerCase();
    for (const [key, limit] of [
      ['opslogin:email:' + email, this.env.OPS_LOGIN_LIMIT_PER_EMAIL_HOUR],
      ['opslogin:ip:' + input.ip, this.env.OPS_LOGIN_LIMIT_PER_IP_HOUR],
    ] as const) {
      const r = await this.limiter.hit(key, limit, HOUR);
      if (!r.allowed) throw this.rateLimited(r.retryAfterSec);
    }
    const account = await this.repo.findOpsAccount(email);
    const passwordOk = verifyPassword(input.password, account?.passwordHash ?? DUMMY_HASH);
    const user = account?.user;
    if (!user || !account.passwordHash || !passwordOk || !isOps(user.roles))
      throw new DomainError('INVALID_CREDENTIALS', 'Email or password is not right.');
    if (user.status !== 'active') throw new DomainError('ACCOUNT_BLOCKED', 'This account is not active.');
    // Pre-launch production may run the console on password only (OPS_LOGIN_OTP=off, ADR-024; refused once live).
    if (this.env.OPS_LOGIN_OTP === 'off') return { signedIn: true as const, ...(await this.passwordSession(user, input.deviceId)) };
    const challenge = await this.issueChallenge(user.phone, input.deviceId, 'web_admin', 'en', this.clock());
    return { ...challenge, phoneMasked: maskPhone(user.phone) };
  }

  /** Ops session without the second factor (OPS_LOGIN_OTP=off only). Same tokens and audit trail as after an OTP. */
  private async passwordSession(user: { phone: string }, deviceId: string): Promise<AuthResult> {
    const now = this.clock();
    const sessionId = randomUUID();
    const refreshSecret = newRefreshSecret();
    const refreshTtlSec = this.tokens.refreshTtlFor('web_admin');
    const fresh = await this.repo.transaction(async (tx) => {
      const u = await tx.findUserByPhone(user.phone);
      if (!u || !isOps(u.roles) || u.status !== 'active') throw new DomainError('INVALID_CREDENTIALS', 'Email or password is not right.');
      const device = await tx.upsertDevice({ userId: u.id, deviceId, app: 'web_admin', platform: 'web', appVersion: undefined }, now);
      await tx.createSession({
        id: sessionId,
        userId: u.id,
        deviceRowId: device.id,
        refreshHash: hashRefreshSecret(this.tokens.pepper, refreshSecret),
        expiresAt: new Date(now.getTime() + refreshTtlSec * 1000),
      });
      return u;
    });
    const accessToken = await this.tokens.signAccess({ sub: fresh.id, roles: fresh.roles, did: deviceId, sid: sessionId, app: 'web_admin' });
    return {
      accessToken,
      refreshToken: formatRefreshToken(sessionId, refreshSecret),
      accessExpiresIn: this.tokens.accessTtlSec,
      refreshExpiresIn: refreshTtlSec,
      user: fresh,
      isNewUser: false,
    };
  }

  /** Ops console step 2: the OTP. Issues a web_admin session (short refresh TTL). */
  async opsVerify(input: OpsVerifyInput): Promise<AuthResult> {
    return this.completeOtp({ ...input, app: 'web_admin', platform: 'web' }, null);
  }

  async verifyOtp(input: OtpVerifyInput): Promise<AuthResult> {
    return this.completeOtp(input, SIGNUP_ROLE[input.app]);
  }

  /**
   * Verifies the code and opens a session. signupRole set = app sign-in (creates the user if new
   * and self-grants that role); null = ops sign-in (user must exist and hold an ops role).
   */
  private async completeOtp(
    input: { challengeId: string; code: string; deviceId: string; app: AppId; platform: Platform; appVersion?: string | undefined },
    signupRole: (typeof SIGNUP_ROLE)[SignupApp] | null,
  ): Promise<AuthResult> {
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
    const refreshTtlSec = this.tokens.refreshTtlFor(input.app);
    const refreshExpiresAt = new Date(now.getTime() + refreshTtlSec * 1000);

    const { user, isNewUser } = await this.repo.transaction(async (tx) => {
      if (!(await tx.consumeChallenge(challenge.id, now)))
        throw new DomainError('OTP_INVALID', 'That code is not valid. Request a new one.');

      let user = await tx.findUserByPhone(challenge.phone);
      const isNewUser = !user;
      if (!signupRole) {
        // Ops sign-in: never creates users or grants roles.
        if (!user || !isOps(user.roles)) throw new DomainError('INVALID_CREDENTIALS', 'Email or password is not right.');
      } else if (!user) {
        user = await tx.createUser(challenge.phone);
        await tx.appendEvent({
          type: 'user.registered',
          aggregate: { type: 'user', id: user.id },
          actor: { type: 'user', id: user.id },
          payload: { user_id: user.id, app: input.app },
        });
      }
      if (user.status !== 'active') throw new DomainError('ACCOUNT_BLOCKED', 'This account is not active. Contact support.');

      const role = signupRole;
      if (role && (await tx.grantRole(user.id, role, null))) {
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
      refreshExpiresIn: refreshTtlSec,
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
    const refreshTtlSec = this.tokens.refreshTtlFor(session.app);
    const expiresAt = new Date(now.getTime() + refreshTtlSec * 1000);
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
      refreshExpiresIn: refreshTtlSec,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.revokeSession(sessionId, 'logout', this.clock());
  }

  /** DPDP erasure (M8): anonymise the account and end every session. */
  async erase(userId: string): Promise<void> {
    await this.repo.anonymize(userId, this.clock());
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
