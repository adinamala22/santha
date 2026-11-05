import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DispatchTrackingModule } from '../dispatch-tracking/dispatch-tracking.module';
import { IdentityKycModule } from '../identity-kyc/identity-kyc.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { OpsSupportController, SupportController } from './support.controller';
import { InMemorySupportRepository, PrismaSupportRepository, SupportRepository } from './support.repository';
import { SupportService } from './support.service';

/**
 * support — chat with Santha support for customers, stores and riders (ADR-028). Owns support_threads and
 * support_messages; reads orders, stores and deliveries only to check that an order is the requester's.
 */
@Module({
  imports: [OrdersModule, MerchantCatalogueModule, DispatchTrackingModule, IdentityKycModule, NotificationsModule],
  controllers: [SupportController, OpsSupportController],
  providers: [
    {
      provide: SupportRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) => (env.DATA_STORE === 'memory' ? new InMemorySupportRepository(sinks) : new PrismaSupportRepository(prisma)),
    },
    SupportService,
  ],
  exports: [SupportService],
})
export class SupportModule {}
