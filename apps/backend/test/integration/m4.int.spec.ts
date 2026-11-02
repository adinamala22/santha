/**
 * M4 on the real stack: Postgres (+ migrations + seed) and Redis (idempotency keys, BullMQ:
 * outbox relay → events worker → payment.captured / order.placed handlers). Covers the money path
 * against the production engines: a paid order reaching PLACED through the outbox, Idempotency-Key
 * replays from Redis, signed webhooks stored once, concurrent promo redemptions never overspending
 * the budget (compare-and-swap in SQL), and unpaid orders lapsing.
 * Testcontainers by default; INT_DATABASE_URL + INT_REDIS_URL reuse a running stack.
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
import { hmacHex, MOCK_KEY_SECRET, MOCK_WEBHOOK_SECRET } from '../../src/infra/providers/payments/payments.provider';
import { OrdersService } from '../../src/modules/orders/orders.service';

const backendDir = resolve(__dirname, '../..');
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const kitchen = SEED_MERCHANTS.find((m) => m.name === "Saraswathi's Kitchen")!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('M4 on Postgres + Redis', () => {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let app: INestApplication;
  let prisma: PrismaService;
  let offsetMs = 0;
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
    const deviceId = `int-m4-${phone}-${randomInt(1e6)}`;
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

  it('ACCEPTANCE: a paid order reaches PLACED through outbox → BullMQ, with the bill stored to the paisa', async () => {
    const s = await consumerWithAddress('9876500501');
    await bigCart(s);
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId: s.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(s.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'online' }).expect(201)).body;
    const { intentId, providerOrderId } = o.payment;
    await http()
      .post(`/v1/payments/${intentId}/confirm`)
      .set(s.headers)
      .set('Idempotency-Key', key())
      .send({ providerOrderId, providerPaymentId: 'pay_int_1', signature: hmacHex(MOCK_KEY_SECRET, `${providerOrderId}|pay_int_1`) })
      .expect(200);
    const placed = await until(() => prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { lines: true, history: true } }), (x) => x.state === 'PLACED');
    expect(placed.state).toBe('PLACED');
    expect(placed.totalPaise).toBe(placed.itemsPaise + placed.feesPaise + placed.taxPaise - placed.discountPaise);
    expect(placed.totalPaise).toBe(q.bill.totalPaise);
    expect(placed.lines.reduce((sum, l) => sum + l.linePaise, 0)).toBe(placed.itemsPaise);
    expect(placed.history.map((h) => h.to).sort()).toEqual(['AWAITING_PAYMENT', 'PLACED']);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: o.id, type: 'order.placed' } })).toBe(1);
    // The order.placed consumer empties the cart.
    const cart = await until(() => http().get('/v1/cart').set(s.headers), (r) => r.body.lines.length === 0);
    expect(cart.body.lines).toEqual([]);
  });

  it('ACCEPTANCE: Idempotency-Key replays come from Redis and the DB key is unique', async () => {
    const s = await consumerWithAddress('9876500502');
    await bigCart(s);
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId: s.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const k = key();
    const [a, b] = await Promise.all([
      http().post('/v1/orders').set(s.headers).set('Idempotency-Key', k).send({ quoteId: q.quoteId, paymentMethod: 'cod' }),
      http().post('/v1/orders').set(s.headers).set('Idempotency-Key', k).send({ quoteId: q.quoteId, paymentMethod: 'cod' }),
    ]);
    // One wins; a concurrent duplicate is told to retry (409) — never a second order.
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([201]));
    const replay = await http().post('/v1/orders').set(s.headers).set('Idempotency-Key', k).send({ quoteId: q.quoteId, paymentMethod: 'cod' }).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const userOrders = await prisma.order.findMany({ where: { idempotencyKey: k } });
    expect(userOrders).toHaveLength(1);
    expect(replay.body.id).toBe(userOrders[0]!.id);
  });

  it('ACCEPTANCE: concurrent orders never overspend a promo budget (SQL compare-and-swap)', async () => {
    // TINY: ₹60 off with a ₹100 budget → exactly one of five simultaneous orders gets it.
    const people = await Promise.all([0, 1, 2, 3, 4].map((i) => consumerWithAddress(`98765006${String(i).padStart(2, '0')}`)));
    const quotes: Array<{ quoteId: string; promo: { applied: boolean } }> = [];
    for (const p of people) {
      await bigCart(p);
      quotes.push((await http().post('/v1/cart/price').set(p.headers).send({ addressId: p.addressId, when: { mode: 'asap' }, promoCode: 'TINY' }).expect(200)).body);
    }
    expect(quotes.every((x) => x.promo.applied)).toBe(true); // all quoted while budget remained
    const results = await Promise.all(people.map((p, i) => http().post('/v1/orders').set(p.headers).set('Idempotency-Key', key()).send({ quoteId: quotes[i]!.quoteId, paymentMethod: 'cod' })));
    const outcomes = results.map((r) => `${r.status}:${r.body.error?.code ?? 'ok'}:${r.body.error?.message ?? ''}`);
    expect(results.filter((r) => r.status === 201), outcomes.join(' | ')).toHaveLength(1);
    // Losers are told either that the code ran out (reservation lost) or, if re-pricing already saw
    // the empty budget, that their bill changed (the ₹60 discount is gone).
    const losers = results.filter((r) => r.status !== 201);
    for (const r of losers) {
      expect(['PROMO_INVALID', 'QUOTE_CHANGED'], outcomes.join(' | ')).toContain(r.body.error.code);
      if (r.body.error.code === 'QUOTE_CHANGED') expect(r.body.error.details.totalPaise - r.body.error.details.previousTotalPaise).toBe(6000);
    }
    const tiny = await prisma.promo.findUniqueOrThrow({ where: { code: 'TINY' } });
    expect(tiny.spentPaise).toBe(6000);
    expect(await prisma.promoRedemption.count({ where: { promoId: tiny.id, status: { in: ['reserved', 'confirmed'] } } })).toBe(1);
  });

  it('COD is refused for cooked food', async () => {
    const s = await consumerWithAddress('9876500503');
    const k = await storeItems(kitchen.id);
    const meals = k.items.find((i) => i.name === 'Veg Meals')!;
    await http().put('/v1/cart').set(s.headers).send({ merchantId: kitchen.id, replace: true, lines: [{ itemId: meals.id, variantId: meals.variants[0]!.id, quantity: 2 }] }).expect(200);
    const slot = k.slots!.occurrences.filter((o) => o.state === 'open').at(-1)!;
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId: s.addressId, when: { mode: 'slot', slotId: slot.slotId, date: slot.date } }).expect(200)).body;
    expect(q.payment.cod).toMatchObject({ available: false, reason: 'cooked_food' });
    await http().post('/v1/orders').set(s.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'cod' }).expect(422);
  });

  it('signed webhooks are stored once; unpaid orders lapse after the window', async () => {
    const s = await consumerWithAddress('9876500504');
    await bigCart(s);
    const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId: s.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(s.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'online' }).expect(201)).body;
    const body = JSON.stringify({ event: 'payment.failed', created_at: 2, payload: { payment: { entity: { id: 'pay_int_f', order_id: o.payment.providerOrderId, error_description: 'Card declined' } } } });
    const sig = hmacHex(MOCK_WEBHOOK_SECRET, body);
    for (let i = 0; i < 2; i++)
      await http().post('/v1/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).set('X-Razorpay-Event-Id', `evt_int_${o.id}`).send(body).expect(200);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: `evt_int_${o.id}` } })).toBe(1);
    expect((await prisma.paymentIntent.findUniqueOrThrow({ where: { orderId: o.id } })).failureReason).toBe('Card declined');

    offsetMs += 16 * 60_000;
    await app.get(OrdersService).expireUnpaid();
    const lapsed = await until(() => prisma.order.findUniqueOrThrow({ where: { id: o.id } }), (x) => x.state === 'PAYMENT_FAILED');
    expect(lapsed.state).toBe('PAYMENT_FAILED');
    const intent = await until(() => prisma.paymentIntent.findUniqueOrThrow({ where: { orderId: o.id } }), (x) => x.status === 'failed');
    expect(intent.status).toBe('failed');
  });
});
