import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { CartPricingModule } from '../cart-pricing/cart-pricing.module';
import { IdentityKycModule } from '../identity-kyc/identity-kyc.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsSettlementModule } from '../payments-settlement/payments-settlement.module';
import { CustomerOrderActionsController, MerchantOrdersController, OpsOrdersController } from './lifecycle.controller';
import { OrderLifecycleService } from './lifecycle.service';
import { PaymentExpiryJob } from './jobs/payment-expiry.job';
import { DevOrderJobsController, OrdersController } from './orders.controller';
import { InMemoryOrderRepository, OrderRepository, PrismaOrderRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * orders — checkout, placing orders (Idempotency-Key), and the order aggregate with the single
 * guarded transition() (state-machine.ts). M4: placement and payment states; M5: the lifecycle.
 * Events out: order.created, order.placed, order.payment_failed (+ lifecycle events in M5).
 * Events in: payment.captured. Owns orders, order_lines, order_transitions.
 */
@Module({
  imports: [CartPricingModule, PaymentsSettlementModule, MerchantCatalogueModule, AnalyticsConfigModule, IdentityKycModule, NotificationsModule],
  controllers: [OrdersController, DevOrderJobsController, MerchantOrdersController, CustomerOrderActionsController, OpsOrdersController],
  providers: [
    OrdersService,
    OrderLifecycleService,
    IdempotencyService,
    PaymentExpiryJob,
    {
      provide: OrderRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) =>
        env.DATA_STORE === 'memory' ? new InMemoryOrderRepository(sinks) : new PrismaOrderRepository(prisma),
    },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
