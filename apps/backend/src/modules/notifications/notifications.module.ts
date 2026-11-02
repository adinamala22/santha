import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MessagingProvider, MockMessagingProvider } from '../../infra/providers/messaging/messaging.provider';
import { FcmPushProvider, MockPushProvider, PushProvider } from '../../infra/providers/push/push.provider';
import { IdentityKycModule } from '../identity-kyc/identity-kyc.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { NotificationsController } from './notifications.controller';
import { InMemoryNotificationRepository, NotificationRepository, PrismaNotificationRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * notifications — en/te templates per event; channels socket (Socket.IO /v1/realtime), push (FCM),
 * SMS, WhatsApp (opt-in) and voice (merchant reminders), each behind a provider with a mock; every
 * send lands in the comms log. Events in: order.*, merchant.auto_paused.
 */
@Module({
  imports: [IdentityKycModule, MerchantCatalogueModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    RealtimeGateway,
    {
      provide: NotificationRepository,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService) => (env.DATA_STORE === 'memory' ? new InMemoryNotificationRepository() : new PrismaNotificationRepository(prisma)),
    },
    {
      provide: PushProvider,
      inject: [ENV],
      useFactory: (env: Env) => (env.DATA_STORE !== 'memory' && env.PUSH_PROVIDER === 'fcm' ? new FcmPushProvider(env.FCM_SERVICE_ACCOUNT_B64!) : new MockPushProvider()),
    },
    // SMS (MSG91), WhatsApp (Meta Cloud API) and voice (Exotel) adapters arrive with their accounts (docs/deployment-and-costs.md).
    { provide: MessagingProvider, useValue: new MockMessagingProvider() },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
