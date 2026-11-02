import { Logger, Module } from '@nestjs/common';
import { SEED_ADDRESSES, SEED_MICRO_MARKETS, SEED_EFFECTIVE_FROM, seedUserId } from '../../dev/seed-data';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { AddressesController } from './addresses.controller';
import { type AddressRecord, AddressRepository, InMemoryAddressRepository, PrismaAddressRepository } from './addresses.repository';
import { AddressesService } from './addresses.service';
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
/** Demo addresses of the seeded consumers (same rows in fake mode and the Postgres seed). */
export async function buildSeedAddresses(markets: Pick<MicroMarketsService, 'list'>): Promise<AddressRecord[]> {
  const ids = new Map((await markets.list()).map((m) => [m.market.slug, m.market.id]));
  return SEED_ADDRESSES.map((a) => {
    const c = SEED_MICRO_MARKETS.find((m) => m.slug === a.microMarketSlug)!.centre;
    return {
      id: a.id,
      userId: seedUserId(a.ownerPhone),
      label: a.label,
      name: a.name ?? null,
      line: a.line,
      landmark: a.landmark ?? null,
      pincode: a.pincode,
      location: { lat: c.lat + a.offset.lat, lng: c.lng + a.offset.lng },
      microMarketId: ids.get(a.microMarketSlug) ?? null,
      isDefault: a.isDefault,
      createdAt: SEED_EFFECTIVE_FROM,
      updatedAt: SEED_EFFECTIVE_FROM,
    };
  });
}

@Module({
  imports: [JwtModule.register({}), AnalyticsConfigModule],
  controllers: [AuthController, MeController, AddressesController],
  providers: [
    AuthService,
    AddressesService,
    {
      provide: AddressRepository,
      inject: [ENV, PrismaService, MicroMarketsService],
      useFactory: async (env: Env, prisma: PrismaService, markets: MicroMarketsService) => {
        if (env.DATA_STORE !== 'memory') return new PrismaAddressRepository(prisma);
        const repo = new InMemoryAddressRepository();
        repo.seed(await buildSeedAddresses(markets));
        return repo;
      },
    },
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
  exports: [TokenService, KycService, AddressesService, AuthService],
})
export class IdentityKycModule {}
