import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { parseEnv } from './config/env';

export const API_PREFIX = 'v1';

export function configureApp(app: INestApplication): void {
  const env = parseEnv(process.env);
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();
  // Security headers on every response (M8 hardening; the API serves JSON only, so CSP denies everything).
  const http = app as NestExpressApplication;
  http.disable('x-powered-by');
  http.use((req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Swagger UI (/docs) needs its own scripts and styles.
    if (!req.url?.startsWith('/docs')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (env.APP_ENV !== 'dev') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // Fake mode receives image uploads itself (MemoryObjectStorage presigned URLs → PUT /v1/dev/uploads).
  if (env.DATA_STORE === 'memory')
    (app as NestExpressApplication).useBodyParser('raw', { type: ['image/*', 'application/octet-stream'], limit: env.MAX_UPLOAD_BYTES });
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Santha API')
    .setDescription('Santha hyperlocal marketplace — REST /v1. Generated from NestJS decorators; do not edit by hand.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

export async function createApp(): Promise<INestApplication> {
  // rawBody: webhook signatures are verified over the exact bytes received.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const doc = buildOpenApi(app);
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'docs/openapi.json' });
  return app;
}
