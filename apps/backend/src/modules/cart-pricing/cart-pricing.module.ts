import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { buildSeedPromos } from '../../dev/seed-records';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { CartController, OpsPromosController } from './cart-pricing.controller';
import { CartPricingRepository, InMemoryCartPricingRepository, PrismaCartPricingRepository } from './cart-pricing.repository';
import { CartPricingService } from './cart-pricing.service';

/**
 * cart-pricing — carts (one store at a time), computeQuote over the live catalogue and the
 * micro-market fee card, quote snapshots, promos with budgets (M4).
 * Events in: order.placed, order.payment_failed, order.cancelled, order.rejected, order.expired.
 * Owns carts, quotes, promos, promo_redemptions; other modules use CartPricingService only.
 */
@Module({
  imports: [MerchantCatalogueModule, AnalyticsConfigModule],
  controllers: [CartController, OpsPromosController],
  providers: [
    CartPricingService,
    {
      provide: CartPricingRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) => {
        if (env.DATA_STORE !== 'memory') return new PrismaCartPricingRepository(prisma);
        const repo = new InMemoryCartPricingRepository(sinks);
        repo.seedPromos(buildSeedPromos());
        return repo;
      },
    },
  ],
  exports: [CartPricingService],
})
export class CartPricingModule {}
