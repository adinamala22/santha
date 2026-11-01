/**
 * M1 end to end on the real stack (Postgres + PostGIS + Redis): ops sign-in, micro-market version
 * → serviceability via ST_Covers, merchant onboarding → approve → live, audit rows and outbox
 * events in the database. Testcontainers by default; INT_DATABASE_URL + INT_REDIS_URL reuse a
 * running stack (the test only creates uniquely named rows).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rect } from '../../src/common/geo/polygon';
import { SEED_OPS_PASSWORD } from '../../src/dev/seed-data';
import { DEFAULT_CONFIG } from '../../src/modules/analytics-config/domain/micro-market-config';
import { gstinCheckChar, verhoeffCheckDigit } from '../../src/modules/identity-kyc/domain/kyc-formats';
import { PrismaService } from '../../src/infra/prisma/prisma.service';

const backendDir = resolve(__dirname, '../..');

describe('M1 on Postgres/PostGIS + Redis', () => {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (s: { accessToken: string; deviceId: string }) => ({ Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': s.deviceId });

  beforeAll(async () => {
    let dbUrl = process.env.INT_DATABASE_URL;
    let redisUrl = process.env.INT_REDIS_URL;
    if (!dbUrl || !redisUrl) {
      const [{ PostgreSqlContainer }, { RedisContainer }] = await Promise.all([
        import('@testcontainers/postgresql'),
        import('@testcontainers/redis'),
      ]);
      [pg, redis] = await Promise.all([new PostgreSqlContainer('postgis/postgis:16-3.4').start(), new RedisContainer('redis:7-alpine').start()]);
      dbUrl = pg.getConnectionUri();
      redisUrl = redis.getConnectionUrl();
      execSync('npx prisma migrate deploy', { cwd: backendDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'pipe' });
    }
    Object.assign(process.env, {
      DATABASE_URL: dbUrl,
      REDIS_URL: redisUrl,
      DATA_STORE: 'postgres',
      RUN_WORKERS: 'false',
      MOCK_OTP_CODE: '123456',
      OTP_RESEND_COOLDOWN_SEC: '0',
    });
    execSync('node -r @swc-node/register prisma/seed.ts', { cwd: backendDir, env: { ...process.env }, stdio: 'pipe' });

    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.factory');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  let ops: { accessToken: string; deviceId: string; user: { id: string } };

  it('ops signs in with email + password + OTP', async () => {
    const deviceId = 'int-ops-console-1';
    const login = await http().post('/v1/auth/ops/login').send({ email: 'admin@santha.local', password: SEED_OPS_PASSWORD, deviceId }).expect(200);
    const res = await http().post('/v1/auth/ops/verify').send({ challengeId: login.body.challengeId, code: '123456', deviceId }).expect(200);
    ops = { ...res.body, deviceId };
    expect(res.body.refreshExpiresIn).toBe(8 * 3600);
  });

  it('a new micro-market is served by PostGIS at once, with audit row and outbox event', async () => {
    const slug = `int-mm-${randomInt(1e6)}`;
    const lng0 = 70 + Math.random() * 5; // far from Nellore and from other runs
    const created = await http()
      .post('/v1/ops/micro-markets')
      .set(auth(ops))
      .send({ citySlug: 'nellore', slug, name: 'Int test', nameTe: 'పరీక్ష', config: { ...DEFAULT_CONFIG, polygon: rect(lng0, 12, lng0 + 0.01, 12.01) } })
      .expect(201);
    const inside = await http().get(`/v1/serviceability?lat=12.005&lng=${lng0 + 0.005}`).expect(200);
    expect(inside.body.microMarket.slug).toBe(slug);

    await http()
      .post(`/v1/ops/micro-markets/${created.body.id}/versions`)
      .set(auth(ops))
      .send({ config: { ...DEFAULT_CONFIG, polygon: rect(lng0, 12, lng0 + 0.01, 12.02) } })
      .expect(201);
    expect((await http().get(`/v1/serviceability?lat=12.015&lng=${lng0 + 0.005}`)).body.microMarket.slug).toBe(slug);

    const audit = await prisma.auditEvent.findMany({ where: { entityId: created.body.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['created', 'version_published']);
    expect(audit.every((a) => a.actorId === ops.user.id)).toBe(true);
    const events = await prisma.outboxEvent.count({ where: { aggregateId: created.body.id, type: 'config.micro_market_changed' } });
    expect(events).toBe(2);
  });

  it('merchant onboarding → approve → live', async () => {
    const phone = `98765${String(randomInt(1e5)).padStart(5, '0')}`;
    const deviceId = `int-merchant-${phone}`;
    const otp = await http().post('/v1/auth/otp/request').send({ phone, deviceId, app: 'merchant' }).expect(200);
    const s = await http().post('/v1/auth/otp/verify').send({ challengeId: otp.body.challengeId, code: '123456', deviceId, app: 'merchant', platform: 'android' }).expect(200);
    const owner = { accessToken: s.body.accessToken as string, deviceId };

    await http().post('/v1/merchants').set(auth(owner)).send({ type: 'retail', name: 'Int Kirana', sellsFood: true, category: 'kirana' }).expect(201);
    const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '08:00', close: '21:00' }]]));
    const located = await http()
      .patch('/v1/merchants/me')
      .set(auth(owner))
      .send({ location: { lat: 14.4525, lng: 79.996 }, addressLine: '1-1, Dargamitta', pincode: '524003', hours })
      .expect(200);
    expect(located.body.microMarket.slug).toBe('dargamitta'); // resolved by PostGIS
    expect(located.body.merchant.location.lat).toBeCloseTo(14.4525, 6);

    const aadhaar = '34567890123' + verhoeffCheckDigit('34567890123');
    await http().put('/v1/merchants/me/kyc/pan').set(auth(owner)).send({ pan: 'ABCPK1234L', name: 'Int Owner' }).expect(200);
    await http().post('/v1/merchants/me/kyc/aadhaar/start').set(auth(owner)).send({ aadhaar }).expect(200);
    await http().post('/v1/merchants/me/kyc/aadhaar/verify').set(auth(owner)).send({ otp: '123456' }).expect(200);
    const gstin = '37ABCPK1234L1Z' + gstinCheckChar('37ABCPK1234L1Z');
    await http().put('/v1/merchants/me/kyc/gstin').set(auth(owner)).send({ gstin }).expect(200);
    await http().put('/v1/merchants/me/kyc/bank').set(auth(owner)).send({ accountNumber: '998877665544', ifsc: 'HDFC0001234', holderName: 'Int Owner' }).expect(200);
    expect((await http().post('/v1/merchants/me/submit').set(auth(owner)).expect(422)).body.error.details.missing).toEqual(['fssai']);
    await http().put('/v1/merchants/me/kyc/fssai').set(auth(owner)).send({ number: '12345678901234' }).expect(200);
    const submitted = await http().post('/v1/merchants/me/submit').set(auth(owner)).expect(200);
    const id = submitted.body.merchant.id as string;

    const queue = await http().get('/v1/ops/merchants?status=submitted').set(auth(ops)).expect(200);
    expect(queue.body.items.map((i: { merchant: { id: string } }) => i.merchant.id)).toContain(id);

    await http().post(`/v1/ops/merchants/${id}/approve`).set(auth(ops)).send({}).expect(200);
    const live = await http().post(`/v1/ops/merchants/${id}/go-live`).set(auth(ops)).expect(200);
    expect(live.body.merchant.status).toBe('live');

    const audit = await prisma.auditEvent.findMany({ where: { entity: 'merchant', entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['approved', 'went_live']);
    const types = (await prisma.outboxEvent.findMany({ where: { aggregateId: id }, orderBy: { occurredAt: 'asc' } })).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['merchant.created', 'merchant.kyc_updated', 'merchant.submitted', 'merchant.approved', 'merchant.went_live']),
    );
    const pan = await prisma.kycCheck.findFirst({ where: { subjectId: id, kind: 'pan' } });
    expect(pan?.valueMasked).toBe('AB******4L'); // the full PAN is never stored
  });
});
