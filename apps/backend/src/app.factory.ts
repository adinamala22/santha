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
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const doc = buildOpenApi(app);
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'docs/openapi.json' });
  return app;
}
