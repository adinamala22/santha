import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DispatchTrackingModule } from '../dispatch-tracking/dispatch-tracking.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { OrdersModule } from '../orders/orders.module';
import { SettlementModule } from '../payments-settlement/settlement/settlement.module';
import { IssuesController, OpsIssuesController } from './issues.controller';
import { InMemoryIssuesRepository, IssuesRepository, PrismaIssuesRepository } from './issues.repository';
import { IssuesService } from './issues.service';

/**
 * trust-safety, customer recourse (M7): issues with reporting windows decided by the refunds rules
 * engine and trust scores, and ratings (which feed the rider score). Separate from TrustSafetyModule
 * (screening), which the catalogue imports, to keep the module graph acyclic.
 */
@Module({
  imports: [OrdersModule, MerchantCatalogueModule, DispatchTrackingModule, SettlementModule],
  controllers: [IssuesController, OpsIssuesController],
  providers: [
    {
      provide: IssuesRepository,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService) => (env.DATA_STORE === 'memory' ? new InMemoryIssuesRepository() : new PrismaIssuesRepository(prisma)),
    },
    IssuesService,
  ],
  exports: [IssuesService],
})
export class IssuesModule {}
