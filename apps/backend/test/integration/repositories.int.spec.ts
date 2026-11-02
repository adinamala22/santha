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
import { PrismaCatalogueRepository } from '../../src/modules/merchant-catalogue/catalogue.repository';
import { catalogueRepositoryContract } from '../contracts/catalogue.contract';
import { addressRepositoryContract } from '../contracts/address.contract';
import { PrismaAddressRepository } from '../../src/modules/identity-kyc/addresses.repository';
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
catalogueRepositoryContract('prisma', async () => ({ catalogue: new PrismaCatalogueRepository(prisma), merchants: new PrismaMerchantRepository(prisma) }));
addressRepositoryContract('prisma', async () => ({
  repo: new PrismaAddressRepository(prisma),
  userId: async () => (await prisma.user.create({ data: { phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).id,
}));

// M4
import { orderRepositoryContract, paymentsRepositoryContract, promoRepositoryContract } from '../contracts/m4.contract';
import { PrismaOrderRepository } from '../../src/modules/orders/orders.repository';
import { PrismaCartPricingRepository } from '../../src/modules/cart-pricing/cart-pricing.repository';
import { PrismaPaymentsRepository } from '../../src/modules/payments-settlement/payments.repository';

orderRepositoryContract('prisma', async () => new PrismaOrderRepository(prisma));
promoRepositoryContract('prisma', async () => new PrismaCartPricingRepository(prisma));
paymentsRepositoryContract('prisma', async () => new PrismaPaymentsRepository(prisma));

// M5
import { notificationRepositoryContract, orderLifecycleContract } from '../contracts/m5.contract';
import { PrismaNotificationRepository } from '../../src/modules/notifications/notifications.repository';

orderLifecycleContract('prisma', async () => new PrismaOrderRepository(prisma));
notificationRepositoryContract('prisma', async () => ({ repo: new PrismaNotificationRepository(prisma), userId: async () => (await prisma.user.create({ data: { phone: `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).id }));

// M6
import { dispatchRepositoryContract } from '../contracts/m6.contract';
import { PrismaDispatchRepository } from '../../src/modules/dispatch-tracking/dispatch.repository';

dispatchRepositoryContract('prisma', async () => ({
  repo: new PrismaDispatchRepository(prisma),
  riderId: async () => (await prisma.user.create({ data: { phone: `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).id,
}));

// M7
import { issuesRepositoryContract, moneyRepositoryContract } from '../contracts/m7.contract';
import { PrismaMoneyRepository } from '../../src/modules/payments-settlement/settlement/money.repository';
import { PrismaIssuesRepository } from '../../src/modules/trust-safety/issues.repository';

moneyRepositoryContract('prisma', async () => new PrismaMoneyRepository(prisma));
issuesRepositoryContract('prisma', async () => new PrismaIssuesRepository(prisma));

// M8
import { complianceRepositoryContract, leadsRepositoryContract, reviewModerationContract } from '../contracts/m8.contract';
import { PrismaLeadsRepository } from '../../src/modules/analytics-config/growth/leads.repository';
import { PrismaComplianceRepository } from '../../src/modules/trust-safety/compliance.repository';

complianceRepositoryContract('prisma', async () => ({
  repo: new PrismaComplianceRepository(prisma),
  userId: async () => (await prisma.user.create({ data: { phone: `+9195${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).id,
}));
leadsRepositoryContract('prisma', async () => new PrismaLeadsRepository(prisma));
reviewModerationContract('prisma', async () => new PrismaIssuesRepository(prisma));
