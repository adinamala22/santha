/**
 * Writes the OpenAPI document without connecting to any infrastructure:
 *   apps/backend/openapi.json → packages/shared-types/openapi.json and packages/santha_api/openapi.json
 * Run: pnpm --filter backend openapi:gen   (root: pnpm openapi:gen also regenerates the TS types)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Placeholder env so config validation passes; nothing connects in preview mode.
process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@localhost:5432/openapi';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'openapi-gen-only';
process.env.JWT_REFRESH_SECRET ??= 'openapi-gen-only';
process.env.RUN_WORKERS = 'false';

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module');
  const { API_PREFIX, buildOpenApi } = await import('../src/app.factory');
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  app.setGlobalPrefix(API_PREFIX);
  const doc = buildOpenApi(app);
  const json = `${JSON.stringify(doc, null, 2)}\n`;

  const root = resolve(__dirname, '../../..');
  for (const target of [
    'apps/backend/openapi.json',
    'packages/shared-types/openapi.json',
    'packages/santha_api/openapi.json',
  ]) {
    const file = resolve(root, target);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json);
    console.log(`wrote ${target}`);
  }
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
