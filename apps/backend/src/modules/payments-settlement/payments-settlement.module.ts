import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MockPaymentsProvider, PaymentsProvider, RazorpayProvider } from '../../infra/providers/payments/payments.provider';
import { DevPaymentsController, DevTipsController, PaymentsController, WebhooksController } from './payments.controller';
import { InMemoryPaymentsRepository, PaymentsRepository, PrismaPaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

/**
 * payments-settlement — payment intents, Razorpay checkout confirmation and webhooks, wallet
 * (refund credits only) in M4; refunds, settlement runs and reconciliation in M7.
 * Events out: payment.intent_created, payment.captured, payment.failed, wallet.credited.
 * Owns payment_intents, webhook_events, wallet_entries.
 */
@Module({
  controllers: [PaymentsController, WebhooksController, DevPaymentsController, DevTipsController],
  providers: [
    PaymentsService,
    IdempotencyService,
    {
      provide: PaymentsRepository,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) =>
        env.DATA_STORE === 'memory' ? new InMemoryPaymentsRepository(sinks) : new PrismaPaymentsRepository(prisma),
    },
    {
      provide: PaymentsProvider,
      inject: [ENV],
      // Fake mode never talks to a gateway; sandbox and live both use Razorpay (test vs live keys).
      useFactory: (env: Env) =>
        env.DATA_STORE === 'memory' || env.PAYMENTS_PROVIDER === 'mock'
          ? new MockPaymentsProvider()
          : new RazorpayProvider(env.RAZORPAY_KEY_ID!, env.RAZORPAY_KEY_SECRET!, env.RAZORPAY_WEBHOOK_SECRET!),
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsSettlementModule {}
