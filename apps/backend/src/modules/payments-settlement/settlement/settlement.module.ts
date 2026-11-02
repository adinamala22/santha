import { Module } from '@nestjs/common';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { FakeSinks } from '../../../infra/fake/fake-sinks';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AnalyticsConfigModule } from '../../analytics-config/analytics-config.module';
import { DispatchTrackingModule } from '../../dispatch-tracking/dispatch-tracking.module';
import { MerchantCatalogueModule } from '../../merchant-catalogue/merchant-catalogue.module';
import { OrdersModule } from '../../orders/orders.module';
import { PaymentsSettlementModule } from '../payments-settlement.module';
import { InMemoryMoneyRepository, MoneyRepository, PrismaMoneyRepository } from './money.repository';
import { RefundsService } from './refunds.service';
import { MerchantMoneyController, OpsMoneyController, RiderMoneyController } from './settlement.controller';
import { SettlementService } from './settlement.service';

/**
 * payments-settlement, money-close part (M7, ADR-013): settlement runs and payouts with statements,
 * refunds with four-eyes approval, reconciliation against the aggregator report, merchant disputes.
 * A separate Nest module so it can depend on orders and dispatch (which themselves use payments).
 */
@Module({
  imports: [PaymentsSettlementModule, OrdersModule, DispatchTrackingModule, MerchantCatalogueModule, AnalyticsConfigModule],
  controllers: [MerchantMoneyController, RiderMoneyController, OpsMoneyController],
  providers: [
    {
      provide: MoneyRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) => (env.DATA_STORE === 'memory' ? new InMemoryMoneyRepository(sinks) : new PrismaMoneyRepository(prisma)),
    },
    RefundsService,
    SettlementService,
  ],
  exports: [RefundsService, SettlementService],
})
export class SettlementModule {}
