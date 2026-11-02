import { Logger, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { buildSeedMerchants } from '../../dev/seed-records';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { IdentityKycModule } from '../identity-kyc/identity-kyc.module';
import { MerchantsController, OpsMerchantsController } from './merchants.controller';
import { InMemoryMerchantRepository, MerchantRepository, PrismaMerchantRepository } from './merchants.repository';
import { MerchantsService } from './merchants.service';

/**
 * merchant-catalogue — merchants, staff, hours, radius (M1); catalogue items, master catalogue,
 * stock (M2). Events out: merchant.created, merchant.submitted, merchant.approved,
 * merchant.rejected, merchant.went_live, merchant.staff_added (merchant.kyc_updated comes from
 * identity-kyc's KycService).
 */
@Module({
  imports: [IdentityKycModule, AnalyticsConfigModule],
  controllers: [MerchantsController, OpsMerchantsController],
  providers: [
    MerchantsService,
    {
      provide: MerchantRepository,
      inject: [ENV, PrismaService, FakeSinks, MicroMarketsService],
      useFactory: async (env: Env, prisma: PrismaService, sinks: FakeSinks, markets: MicroMarketsService) => {
        if (env.DATA_STORE !== 'memory') return new PrismaMerchantRepository(prisma);
        // Fake mode: the 12 demo merchants in the seeded micro-markets (identity-kyc seeds their KYC).
        const repo = new InMemoryMerchantRepository(sinks);
        const ids = new Map((await markets.list()).map((m) => [m.market.slug, m.market.id]));
        const seed = buildSeedMerchants(ids);
        repo.seed(seed.merchants, seed.staff);
        new Logger('FakeStore').log(`${seed.merchants.length} demo merchants loaded`);
        return repo;
      },
    },
  ],
  exports: [MerchantsService],
})
export class MerchantCatalogueModule {}
