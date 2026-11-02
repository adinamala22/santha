import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DispatchTrackingModule } from '../dispatch-tracking/dispatch-tracking.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { OrdersModule } from '../orders/orders.module';
import { SettlementModule } from '../payments-settlement/settlement/settlement.module';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { IdentityKycModule } from '../identity-kyc/identity-kyc.module';
import { PaymentsSettlementModule } from '../payments-settlement/payments-settlement.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { ComplianceController, MerchantReviewsController, OpsComplianceController, PublicStoreController } from './compliance.controller';
import { ComplianceRepository, InMemoryComplianceRepository, PrismaComplianceRepository } from './compliance.repository';
import { ComplianceService } from './compliance.service';
import { IssuesController, OpsIssuesController } from './issues.controller';
import { InMemoryIssuesRepository, IssuesRepository, PrismaIssuesRepository } from './issues.repository';
import { IssuesService } from './issues.service';

/**
 * trust-safety, customer recourse (M7): issues with reporting windows decided by the refunds rules
 * engine and trust scores, and ratings (which feed the rider score). Separate from TrustSafetyModule
 * (screening), which the catalogue imports, to keep the module graph acyclic.
 */
@Module({
  imports: [OrdersModule, MerchantCatalogueModule, DispatchTrackingModule, SettlementModule, PaymentsSettlementModule, IdentityKycModule, AnalyticsConfigModule, NotificationsModule],
  controllers: [IssuesController, OpsIssuesController, ComplianceController, MerchantReviewsController, OpsComplianceController, PublicStoreController],
  providers: [
    {
      provide: IssuesRepository,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService) => (env.DATA_STORE === 'memory' ? new InMemoryIssuesRepository() : new PrismaIssuesRepository(prisma)),
    },
    {
      provide: ComplianceRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) => (env.DATA_STORE === 'memory' ? new InMemoryComplianceRepository(sinks) : new PrismaComplianceRepository(prisma)),
    },
    IssuesService,
    ComplianceService,
  ],
  exports: [IssuesService, ComplianceService],
})
export class IssuesModule {}
