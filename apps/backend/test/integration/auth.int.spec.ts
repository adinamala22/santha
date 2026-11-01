/**
 * Integration: real Postgres 16 + PostGIS and Redis 7 via Testcontainers (Docker required).
 * Covers migrations, the OTP login flow against Prisma, Redis rate limiting, the outbox write in
 * the same transaction, and relay → BullMQ `events`. Run: pnpm --filter backend test:int
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEVICE = 'int-test-device-01';

describe('identity-kyc + outbox (Postgres/PostGIS + Redis)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;
  let sms: import('../../src/infra/providers/sms/sms.provider').MockSmsProvider;

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgis/postgis:16-3.4').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    process.env.DATABASE_URL = pg.getConnectionUri();
    process.env.REDIS_URL = redis.getConnectionUrl();
    process.env.RUN_WORKERS = 'false'; // relay is driven manually below

    execSync('npx prisma migrate deploy', {
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env },
      stdio: 'pipe',
    });

    // Import after env is set: config is parsed at provider construction time.
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.factory');
    const { MockSmsProvider, SmsProvider } = await import('../../src/infra/providers/sms/sms.provider');
    sms = new MockSmsProvider();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsProvider)
      .useValue(sms)
      .compile();
    app = mod.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('readiness reports Postgres with PostGIS and Redis', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health/ready').expect(200);
    expect(res.body.checks.postgres.detail).toMatch(/^postgis \d/);
    expect(res.body.checks.redis.ok).toBe(true);
  });

  it('logs in, writes outbox events transactionally and relays them to BullMQ', async () => {
    const http = () => request(app.getHttpServer());
    const r1 = await http()
      .post('/v1/auth/otp/request')
      .send({ phone: '9000000001', deviceId: DEVICE, app: 'consumer' })
      .expect(200);
    const code = sms.lastCodeFor('+919000000001')!;
    const r2 = await http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId: r1.body.challengeId, code, deviceId: DEVICE, app: 'consumer', platform: 'android' })
      .expect(200);
    expect(r2.body.user.roles).toEqual(['consumer']);

    await http()
      .get('/v1/me')
      .set({ Authorization: `Bearer ${r2.body.accessToken}`, 'X-Device-Id': DEVICE })
      .expect(200);

    // resend cooldown enforced from the DB
    await http().post('/v1/auth/otp/request').send({ phone: '9000000001', deviceId: DEVICE, app: 'consumer' }).expect(429);

    const { PrismaService } = await import('../../src/infra/prisma/prisma.service');
    const prisma = app.get(PrismaService);
    const events = await prisma.outboxEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['user.registered', 'user.role_granted']);
    expect(events.every((e) => e.publishedAt === null)).toBe(true);

    const { OutboxRelayService } = await import('../../src/infra/outbox/outbox-relay.service');
    expect(await app.get(OutboxRelayService).relayOnce()).toBe(2);
    const after = await prisma.outboxEvent.findMany();
    expect(after.every((e) => e.publishedAt !== null)).toBe(true);

    const { redisConnectionOptions } = await import('../../src/infra/queues/queues');
    const q = new Queue('events', { connection: redisConnectionOptions(process.env.REDIS_URL!) });
    const jobs = await q.getJobs(['waiting']);
    expect(jobs.map((j) => j.id).sort()).toEqual(events.map((e) => e.id).sort());
    await q.close();
  });
});
