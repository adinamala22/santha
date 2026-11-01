import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { LOG_REDACT_PATHS } from './common/pii';
import { ConfigModule } from './config/config.module';
import { parseEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { AuditModule } from './infra/audit/audit.module';
import { OutboxModule } from './infra/outbox/outbox.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueuesModule } from './infra/queues/queues.module';
import { RedisModule } from './infra/redis/redis.module';
import { AnalyticsConfigModule } from './modules/analytics-config/analytics-config.module';
import { CartPricingModule } from './modules/cart-pricing/cart-pricing.module';
import { DispatchTrackingModule } from './modules/dispatch-tracking/dispatch-tracking.module';
import { IdentityKycModule } from './modules/identity-kyc/identity-kyc.module';
import { MerchantCatalogueModule } from './modules/merchant-catalogue/merchant-catalogue.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsSettlementModule } from './modules/payments-settlement/payments-settlement.module';
import { SearchDiscoveryModule } from './modules/search-discovery/search-discovery.module';
import { TrustSafetyModule } from './modules/trust-safety/trust-safety.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      useFactory: () => {
        const env = parseEnv(process.env);
        return {
          // Express 5 / path-to-regexp v8 syntax for "all routes" (avoids the legacy "*" warning).
          forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
          pinoHttp: {
            level: env.LOG_LEVEL,
            redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            autoLogging: { ignore: (req) => req.url?.startsWith('/v1/health') ?? false },
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          },
        };
      },
    }),
    PrismaModule,
    RedisModule,
    QueuesModule,
    OutboxModule,
    AuditModule,
    IdentityKycModule,
    MerchantCatalogueModule,
    SearchDiscoveryModule,
    CartPricingModule,
    OrdersModule,
    DispatchTrackingModule,
    PaymentsSettlementModule,
    NotificationsModule,
    TrustSafetyModule,
    AnalyticsConfigModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
