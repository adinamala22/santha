/**
 * M5 on the real stack: Postgres + Redis (BullMQ). Accept-window timers are delayed jobs on the timers
 * queue keyed by order id and removed on transition; accept / substitute go through the guarded
 * transition with wallet refunds; the comms log is written; illegal moves are refused.
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
import { CLOCK } from '../../src/common/clock';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { hmacHex, MOCK_KEY_SECRET } from '../../src/infra/providers/payments/payments.provider';
import { QueuesService } from '../../src/infra/queues/queues.service';

const backendDir = resolve(__dirname, '../..');
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('M5 on Postgres + Redis', () => {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let app: INestApplication;
  let prisma: PrismaService;
  const offsetMs = 0;
  const savedEnv = { ...process.env };
  const http = () => request(app.getHttpServer());
  type S = { headers: Record<string, string> };
  let seq = 0;
  const key = () => `int-key-${Date.now()}-${++seq}`;

  beforeAll(async () => {
    let dbUrl = process.env.INT_DATABASE_URL;
    let redisUrl = process.env.INT_REDIS_URL;
    if (!dbUrl || !redisUrl) {
      const [{ PostgreSqlContainer }, { RedisContainer }] = await Promise.all([import('@testcontainers/postgresql'), import('@testcontainers/redis')]);
      [pg, redis] = await Promise.all([new PostgreSqlContainer('postgis/postgis:16-3.4').start(), new RedisContainer('redis:7-alpine').start()]);
      dbUrl = pg.getConnectionUri();
      redisUrl = redis.getConnectionUrl();
      execSync('npx prisma migrate deploy', { cwd: backendDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'pipe' });
    }
    Object.assign(process.env, {
      DATABASE_URL: dbUrl,
      REDIS_URL: redisUrl,
      DATA_STORE: 'postgres',
      SEARCH_ENGINE: 'memory',
      RUN_WORKERS: 'true',
      OUTBOX_POLL_MS: '100',
      MOCK_OTP_CODE: '123456',
      OTP_RESEND_COOLDOWN_SEC: '0',
      OTP_LIMIT_PER_PHONE_HOUR: '1000',
      OTP_LIMIT_PER_DEVICE_HOUR: '1000',
      PAYMENTS_PROVIDER: 'mock',
      MAPS_PROVIDER: 'mock',
    });
    execSync('node -r @swc-node/register prisma/seed.ts', { cwd: backendDir, env: { ...process.env, S3_BUCKET: '' }, stdio: 'pipe' });

    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.factory');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(() => new Date(Date.now() + offsetMs))
      .compile();
    app = mod.createNestApplication({ logger: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
    process.env = savedEnv;
  });

  async function signIn(phone: string, appId: 'consumer' | 'merchant' = 'consumer'): Promise<S> {
    const deviceId = `int-m5-${phone}-${randomInt(1e6)}`;
    const otp = await http().post('/v1/auth/otp/request').send({ phone, deviceId, app: appId }).expect(200);
    const s = await http().post('/v1/auth/otp/verify').send({ challengeId: otp.body.challengeId, code: '123456', deviceId, app: appId, platform: 'android' }).expect(200);
    return { headers: { Authorization: `Bearer ${s.body.accessToken}`, 'X-Device-Id': deviceId } };
  }

  async function consumerWithAddress(phone: string): Promise<S & { addressId: string }> {
    const s = await signIn(phone);
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${randomInt(1, 99)}, Dargamitta Main Road`, location: dargamitta }).expect(201);
    return { ...s, addressId: a.body.id };
  }

  async function storeItems(id: string) {
    return (await http().get(`/v1/stores/${id}?lat=${dargamitta.lat}&lng=${dargamitta.lng}`).expect(200)).body as {
      items: Array<{ id: string; name: string; variants: Array<{ id: string; label: string }> }>;
      slots: { occurrences: Array<{ slotId: string; date: string; state: string }> } | null;
    };
  }

  async function bigCart(s: S) {
    const items = (await storeItems(kirana.id)).items;
    const atta = items.find((i) => i.name === 'Annapoorna Chakki Atta')!;
    const rice = items.find((i) => i.name === 'Annapoorna Basmati Rice')!;
    await http()
      .put('/v1/cart')
      .set(s.headers)
      .send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants.find((v) => v.label === '1 kg')!.id, quantity: 2 }, { itemId: rice.id, variantId: rice.variants[0]!.id, quantity: 1 }] })
      .expect(200);
  }

  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() - t0 > ms) return v;
      await sleep(100);
    }
  }

  async function placeOrder(s: S & { addressId: string }, method: 'online' | 'cod') {
    await bigCart(s);
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId: s.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(s.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method }).expect(201)).body;
    if (method === 'online') {
      const { intentId, providerOrderId } = o.payment;
      const paymentId = `pay_${o.id.slice(0, 8)}`;
      await http()
        .post(`/v1/payments/${intentId}/confirm`)
        .set(s.headers)
        .set('Idempotency-Key', key())
        .send({ providerOrderId, providerPaymentId: paymentId, signature: hmacHex(MOCK_KEY_SECRET, `${providerOrderId}|${paymentId}`) })
        .expect(200);
    }
    return until(() => prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { lines: true } }), (x) => x.state === 'PLACED');
  }

  it('the accept window is a BullMQ delayed job keyed by order id, removed when the store accepts', async () => {
    const s = await consumerWithAddress('9876500801');
    const o = await placeOrder(s, 'cod');
    const timers = app.get(QueuesService).get('timers');
    const job = await until(() => timers.getJob(`order:${o.id}:accept`), (j) => !!j);
    expect(job?.name).toBe('order.accept_timeout');
    expect(await timers.getJob(`order:${o.id}:sms`)).toBeTruthy();
    const owner = await signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const accepted = (await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({}).expect(200)).body;
    expect(accepted.state).toBe('PREPARING');
    expect(await timers.getJob(`order:${o.id}:accept`)).toBeFalsy();
    expect(await timers.getJob(`order:${o.id}:sms`)).toBeFalsy();
    const history = await prisma.orderTransition.findMany({ where: { orderId: o.id }, orderBy: { at: 'asc' } });
    expect(history.map((h) => h.to)).toEqual(['PLACED', 'ACCEPTED', 'PREPARING']);
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({}).expect(409);
  });

  it('substitution refunds the difference to the wallet at once (Postgres); comms are logged', async () => {
    const s = await consumerWithAddress('9876500802');
    const o = await placeOrder(s, 'online');
    const owner = await signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({}).expect(200);
    const attaLine = o.lines.find((l) => l.name === 'Annapoorna Chakki Atta')!;
    const items = (await storeItems(kirana.id)).items as unknown as Array<{ id: string; name: string; variants: Array<{ id: string; pricePaise: number; stock: string }> }>;
    const cheaper = items.flatMap((i) => i.variants.map((v) => ({ i, v }))).find((x) => x.i.name !== attaLine.name && x.v.stock !== 'out' && x.v.pricePaise < attaLine.unitPricePaise)!;
    await http().post(`/v1/orders/${o.id}/items/${attaLine.variantId}/unavailable`).set(owner.headers).send({ action: 'substitute', itemId: cheaper.i.id, variantId: cheaper.v.id }).expect(200);
    const expected = (attaLine.unitPricePaise - cheaper.v.pricePaise) * attaLine.quantity;
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: '+919876500802' } });
    const credited = await prisma.walletEntry.aggregate({ where: { userId: user.id }, _sum: { amountPaise: true } });
    expect(credited._sum.amountPaise).toBe(expected);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).refundedPaise).toBe(expected);
    const comms = await until(() => prisma.notification.findMany({ where: { orderId: o.id } }), (n) => n.some((x) => x.template === 'customer.item_substituted'));
    expect(comms.map((n) => n.template)).toEqual(expect.arrayContaining(['merchant.new_order', 'customer.order_accepted', 'customer.item_substituted']));
  });
});
