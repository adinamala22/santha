import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SEED_CITY, SEED_EFFECTIVE_FROM, SEED_MICRO_MARKETS } from '../../dev/seed-data';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DEFAULT_CONFIG } from './domain/micro-market-config';
import { FlagsService } from './flags.service';
import { InMemoryMicroMarketRepository } from './in-memory-micro-markets.repository';
import { ConfigController, OpsMicroMarketsController } from './micro-markets.controller';
import { MicroMarketRepository, PrismaMicroMarketRepository } from './micro-markets.repository';
import { MicroMarketsService } from './micro-markets.service';

/** DATA_STORE=memory: Nellore and the four seeded micro-markets (version 1 each). */
export async function seedMicroMarkets(repo: MicroMarketRepository): Promise<void> {
  await repo.transaction(async (tx) => {
    const city = await tx.createCity({ ...SEED_CITY });
    for (const m of SEED_MICRO_MARKETS) {
      const market = await tx.createMarket({ cityId: city.id, slug: m.slug, name: m.name, nameTe: m.nameTe });
      await tx.insertVersion({
        ...DEFAULT_CONFIG,
        polygon: m.polygon,
        microMarketId: market.id,
        version: 1,
        effectiveFrom: SEED_EFFECTIVE_FROM,
        note: 'Seeded approximate area',
        createdBy: null,
      });
    }
  });
}

/**
 * analytics-config — micro-market configuration (versioned, effective-dated), serviceability and
 * feature flags. Events out: config.micro_market_changed. Exports MicroMarketsService, FlagsService.
 */
@Module({
  controllers: [OpsMicroMarketsController, ConfigController],
  providers: [
    MicroMarketsService,
    FlagsService,
    {
      provide: MicroMarketRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: async (env: Env, prisma: PrismaService, sinks: FakeSinks) => {
        if (env.DATA_STORE !== 'memory') return new PrismaMicroMarketRepository(prisma);
        const repo = new InMemoryMicroMarketRepository(sinks);
        await seedMicroMarkets(repo);
        return repo;
      },
    },
  ],
  exports: [MicroMarketsService, FlagsService],
})
export class AnalyticsConfigModule {}
