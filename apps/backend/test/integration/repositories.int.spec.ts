/**
 * Runs the repository contracts against Prisma + PostGIS, so the in-memory fakes (fake mode) and
 * Postgres provably behave the same. Testcontainers by default; set INT_DATABASE_URL to reuse an
 * already-migrated database instead (e.g. the docker-compose one — tests use unique ids).
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { PrismaMicroMarketRepository } from '../../src/modules/analytics-config/micro-markets.repository';
import { PrismaKycRepository } from '../../src/modules/identity-kyc/kyc.repository';
import { PrismaMerchantRepository } from '../../src/modules/merchant-catalogue/merchants.repository';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { kycRepositoryContract, merchantRepositoryContract, microMarketRepositoryContract } from '../contracts/repositories.contract';

let pg: StartedPostgreSqlContainer | undefined;
let prisma: PrismaService;

beforeAll(async () => {
  let url = process.env.INT_DATABASE_URL;
  if (!url) {
    // Imported lazily: testcontainers is only needed when no database is supplied.
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    pg = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
    url = pg.getConnectionUri();
    execSync('npx prisma migrate deploy', { cwd: resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  }
  process.env.DATABASE_URL = url;
  prisma = new PrismaService();
});

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.stop();
});

microMarketRepositoryContract('prisma', async () => new PrismaMicroMarketRepository(prisma));
merchantRepositoryContract('prisma', async () => new PrismaMerchantRepository(prisma));
kycRepositoryContract('prisma', async () => new PrismaKycRepository(prisma));
