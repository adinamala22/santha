import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * Background worker entrypoint (ECS `worker` service): outbox relay + queue consumers, no HTTP.
 * In local dev the API process also runs workers (RUN_WORKERS=true), so this is optional there.
 */
async function main(): Promise<void> {
  process.env.RUN_WORKERS = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
}

void main();
