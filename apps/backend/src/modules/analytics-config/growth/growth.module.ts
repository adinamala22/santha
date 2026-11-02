import { Module } from '@nestjs/common';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { DispatchTrackingModule } from '../../dispatch-tracking/dispatch-tracking.module';
import { IdentityKycModule } from '../../identity-kyc/identity-kyc.module';
import { MerchantCatalogueModule } from '../../merchant-catalogue/merchant-catalogue.module';
import { OrdersModule } from '../../orders/orders.module';
import { SettlementModule } from '../../payments-settlement/settlement/settlement.module';
import { IssuesModule } from '../../trust-safety/issues.module';
import { LeadsController, OpsGrowthController } from './growth.controller';
import { GrowthService } from './growth.service';
import { InMemoryLeadsRepository, LeadsRepository, PrismaLeadsRepository } from './leads.repository';

/**
 * analytics-config, growth part (M8, ADR-014): website leads, business reports and the domain-event
 * export to PostHog. A separate Nest module because it reads from orders, dispatch, settlement and
 * trust-safety, which import analytics-config themselves.
 */
@Module({
  imports: [IdentityKycModule, OrdersModule, DispatchTrackingModule, MerchantCatalogueModule, SettlementModule, IssuesModule],
  controllers: [LeadsController, OpsGrowthController],
  providers: [
    {
      provide: LeadsRepository,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService) => (env.DATA_STORE === 'memory' ? new InMemoryLeadsRepository() : new PrismaLeadsRepository(prisma)),
    },
    GrowthService,
  ],
  exports: [GrowthService],
})
export class GrowthModule {}
