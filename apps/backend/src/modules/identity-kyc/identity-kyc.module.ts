import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { CLOCK, systemClock } from '../../common/clock';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MockSmsProvider, Msg91SmsProvider, SmsProvider } from '../../infra/providers/sms/sms.provider';
import { AuthController, MeController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { IdentityRepository, PrismaIdentityRepository } from './identity.repository';
import { RateLimiter, RedisRateLimiter } from './rate-limiter';
import { TokenService } from './token.service';

/**
 * identity-kyc — users, roles, devices, sessions, OTP login. KYC (merchants/riders) arrives in M1.
 * Events out: user.registered, user.role_granted.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    TokenService,
    { provide: IdentityRepository, useClass: PrismaIdentityRepository },
    { provide: RateLimiter, useClass: RedisRateLimiter },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: SmsProvider,
      inject: [ENV],
      useFactory: (env: Env) => (env.OTP_PROVIDER === 'msg91' ? new Msg91SmsProvider() : new MockSmsProvider()),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService],
})
export class IdentityKycModule {}
