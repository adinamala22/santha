import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SEED_OPS_PASSWORD, SEED_PEOPLE } from '../../dev/seed-data';
import { buildSeedKyc } from '../../dev/seed-records';
import { hashPassword } from './domain/secrets';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { DigioKycProvider, KycProvider, MockKycProvider } from '../../infra/providers/kyc/kyc.provider';
import { MockSmsProvider, Msg91SmsProvider, SmsProvider } from '../../infra/providers/sms/sms.provider';
import { REDIS } from '../../infra/redis/redis.module';
import { AuthController, MeController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { InMemoryIdentityRepository } from './in-memory-identity.repository';
import { IdentityRepository, PrismaIdentityRepository } from './identity.repository';
import { InMemoryKycRepository, KycRepository, PrismaKycRepository } from './kyc.repository';
import { KycService } from './kyc.service';
import { MemoryRateLimiter, RateLimiter, RedisRateLimiter } from './rate-limiter';
import { TokenService } from './token.service';

/** DATA_STORE=memory: KYC checks of the demo merchants. */
function createFakeKycRepository(sinks: FakeSinks): InMemoryKycRepository {
  const repo = new InMemoryKycRepository(sinks);
  for (const k of buildSeedKyc()) repo.seed({ type: 'merchant', id: k.merchantId }, k.check);
  return repo;
}

/** DATA_STORE=memory: demo users preloaded; committed events are logged instead of relayed. */
function createFakeIdentityRepository(): InMemoryIdentityRepository {
  const logger = new Logger('FakeStore');
  const repo = new InMemoryIdentityRepository({
    onEvent: (e) => logger.log(`event ${e.type} ${e.aggregate.type}/${e.aggregate.id} ${JSON.stringify(e.payload)}`),
  });
  repo.seed(SEED_PEOPLE, hashPassword(SEED_OPS_PASSWORD));
  logger.warn(
    `DATA_STORE=memory: ${SEED_PEOPLE.length} demo users loaded (numbers in README "Signing in locally"); ` +
      'no Postgres/Redis used, workers off, data resets on restart',
  );
  return repo;
}

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
    {
      provide: IdentityRepository,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService) =>
        env.DATA_STORE === 'memory' ? createFakeIdentityRepository() : new PrismaIdentityRepository(prisma),
    },
    {
      provide: RateLimiter,
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) =>
        env.DATA_STORE === 'memory' ? new MemoryRateLimiter() : new RedisRateLimiter(redis),
    },
    {
      provide: SmsProvider,
      inject: [ENV],
      useFactory: (env: Env) => (env.OTP_PROVIDER === 'msg91' ? new Msg91SmsProvider() : new MockSmsProvider()),
    },
    KycService,
    {
      provide: KycRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) =>
        env.DATA_STORE === 'memory' ? createFakeKycRepository(sinks) : new PrismaKycRepository(prisma),
    },
    {
      provide: KycProvider,
      inject: [ENV],
      useFactory: (env: Env) => (env.KYC_PROVIDER === 'digio' ? new DigioKycProvider() : new MockKycProvider()),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, KycService],
})
export class IdentityKycModule {}
