import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';
import { buildSeedRiders } from '../../dev/seed-records';
import type { Env } from '../../config/env';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  CallMaskingProvider,
  MockCallMaskingProvider,
} from '../../infra/providers/calls/call-masking.provider';
import { MockThreePlProvider, ThreePlProvider } from '../../infra/providers/threepl/threepl.provider';
import { REDIS } from '../../infra/redis/redis.module';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { IdentityKycModule } from '../identity-kyc/identity-kyc.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import {
  MerchantDeliveriesController,
  OpsDispatchController,
  RiderController,
  StaffJobsController,
  TrackingController,
} from './dispatch.controller';
import {
  DispatchRepository,
  InMemoryDispatchRepository,
  PrismaDispatchRepository,
} from './dispatch.repository';
import { DispatchService } from './dispatch.service';
import { DispatchViews } from './dispatch.views';
import { MemoryRiderLocations, RedisRiderLocations, RiderLocations } from './rider-locations';

/**
 * dispatch-tracking — fulfilment assignment, rider offers, fallback ladder, live tracking (M6, ADR-012).
 * Owns riders, fulfilments and dispatch_offers; positions live in Redis GEO. Other modules talk to it
 * through order events (order.accepted / ready / cancelled) and its exported service.
 */
@Module({
  imports: [
    OrdersModule,
    MerchantCatalogueModule,
    AnalyticsConfigModule,
    IdentityKycModule,
    NotificationsModule,
  ],
  controllers: [
    RiderController,
    StaffJobsController,
    TrackingController,
    MerchantDeliveriesController,
    OpsDispatchController,
  ],
  providers: [
    {
      provide: DispatchRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) =>
        env.DATA_STORE === 'memory'
          ? InMemoryDispatchRepository.seeded(sinks, buildSeedRiders())
          : new PrismaDispatchRepository(prisma),
    },
    {
      provide: RiderLocations,
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) =>
        env.DATA_STORE === 'memory' ? new MemoryRiderLocations() : new RedisRiderLocations(redis),
    },
    {
      provide: ThreePlProvider,
      inject: [ENV],
      useFactory: (env: Env) => new MockThreePlProvider(env.MOCK_3PL_AVAILABLE),
    },
    { provide: CallMaskingProvider, useValue: new MockCallMaskingProvider() },
    DispatchService,
    DispatchViews,
  ],
  exports: [DispatchService],
})
export class DispatchTrackingModule {}
