/**
 * M2 on the real stack: Postgres + PostGIS, Redis (BullMQ: outbox relay → events → indexer) and
 * Typesense. Covers the acceptance checks against the production engines: 50 barcode scans
 * against the seeded master catalogue, search p95 < 400 ms with 20k items in Typesense, feed ETA
 * chips, event-driven indexing and the 72 h staleness flag (clock override).
 * Testcontainers by default; INT_DATABASE_URL + INT_REDIS_URL + INT_TYPESENSE_URL (+ key) reuse a
 * running stack (collections get a unique prefix and are dropped afterwards).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOCK } from '../../src/common/clock';
import { everyDay } from '../../src/common/hours';
import { seedMasterRows } from '../../src/dev/seed-catalogue';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS, SEED_OPS_PASSWORD } from '../../src/dev/seed-data';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { MOCK_BARCODE_HITS } from '../../src/infra/providers/barcode/barcode.provider';
import { withCheckDigit } from '../../src/modules/merchant-catalogue/domain/gtin';
import type { ItemDoc, MerchantDoc } from '../../src/modules/search-discovery/domain/documents';
import { SearchIndex } from '../../src/modules/search-discovery/search-index';
import { TypesenseSearchIndex } from '../../src/modules/search-discovery/typesense-search.index';

const backendDir = resolve(__dirname, '../..');
const centre = (slug: string) => SEED_MICRO_MARKETS.find((m) => m.slug === slug)!.centre;
const q = (p: { lat: number; lng: number }) => `lat=${p.lat}&lng=${p.lng}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('M2 on Postgres + Redis + Typesense', () => {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let ts: StartedTestContainer | undefined;
  let app: INestApplication;
  let prisma: PrismaService;
  let offsetMs = 0;
  const savedEnv = { ...process.env };
  const http = () => request(app.getHttpServer());
  const auth = (s: { accessToken: string; deviceId: string }) => ({ Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': s.deviceId });
  const items = (b: { groups: Array<{ items: Array<{ name: string }> }> }) => b.groups.flatMap((g) => g.items.map((i) => i.name));

  beforeAll(async () => {
    let dbUrl = process.env.INT_DATABASE_URL;
    let redisUrl = process.env.INT_REDIS_URL;
    let tsUrl = process.env.INT_TYPESENSE_URL;
    let tsKey = process.env.INT_TYPESENSE_API_KEY ?? 'dev-typesense-key';
    if (!dbUrl || !redisUrl) {
      const [{ PostgreSqlContainer }, { RedisContainer }] = await Promise.all([import('@testcontainers/postgresql'), import('@testcontainers/redis')]);
      [pg, redis] = await Promise.all([new PostgreSqlContainer('postgis/postgis:16-3.4').start(), new RedisContainer('redis:7-alpine').start()]);
      dbUrl = pg.getConnectionUri();
      redisUrl = redis.getConnectionUrl();
      execSync('npx prisma migrate deploy', { cwd: backendDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'pipe' });
    }
    if (!tsUrl) {
      const { GenericContainer, Wait } = await import('testcontainers');
      tsKey = 'int-typesense-key';
      ts = await new GenericContainer('typesense/typesense:27.1')
        .withCommand(['--data-dir', '/tmp', '--api-key', tsKey])
        .withExposedPorts(8108)
        .withWaitStrategy(Wait.forHttp('/health', 8108).forStatusCode(200))
        .start();
      tsUrl = `http://${ts.getHost()}:${ts.getMappedPort(8108)}`;
    }
    const u = new URL(tsUrl);
    Object.assign(process.env, {
      DATABASE_URL: dbUrl,
      REDIS_URL: redisUrl,
      DATA_STORE: 'postgres',
      SEARCH_ENGINE: 'typesense',
      TYPESENSE_HOST: u.hostname,
      TYPESENSE_PORT: u.port || '8108',
      TYPESENSE_PROTOCOL: u.protocol.replace(':', ''),
      TYPESENSE_API_KEY: tsKey,
      TYPESENSE_PREFIX: `int${randomInt(1e6)}_`,
      RUN_WORKERS: 'true', // outbox relay + events worker → search indexer
      OUTBOX_POLL_MS: '100',
      MOCK_OTP_CODE: '123456',
      OTP_RESEND_COOLDOWN_SEC: '0',
      OTP_LIMIT_PER_PHONE_HOUR: '1000',
      OTP_LIMIT_PER_DEVICE_HOUR: '1000',
      BARCODE_PROVIDER: 'mock',
      MAPS_PROVIDER: 'mock',
    });
    execSync('node -r @swc-node/register prisma/seed.ts', { cwd: backendDir, env: { ...process.env, S3_BUCKET: '' }, stdio: 'pipe' });

    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.factory');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(() => new Date(Date.now() + offsetMs))
      .compile();
    app = mod.createNestApplication({ logger: false });
    configureApp(app);
    await app.init(); // the worker process rebuilds the Typesense index at boot
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await (app?.get(SearchIndex) as TypesenseSearchIndex | undefined)?.drop?.();
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop(), ts?.stop()]);
    process.env = savedEnv;
  });

  const signIn = async (phone: string) => {
    const deviceId = `int-m2-${phone}-${randomInt(1e6)}`;
    const otp = await http().post('/v1/auth/otp/request').send({ phone, deviceId, app: 'merchant' }).expect(200);
    const s = await http().post('/v1/auth/otp/verify').send({ challengeId: otp.body.challengeId, code: '123456', deviceId, app: 'merchant', platform: 'android' }).expect(200);
    return { accessToken: s.body.accessToken as string, deviceId };
  };
  const opsSignIn = async () => {
    const deviceId = `int-m2-ops-${randomInt(1e6)}`;
    const login = await http().post('/v1/auth/ops/login').send({ email: 'admin@santha.local', password: SEED_OPS_PASSWORD, deviceId }).expect(200);
    const res = await http().post('/v1/auth/ops/verify').send({ challengeId: login.body.challengeId, code: '123456', deviceId }).expect(200);
    return { accessToken: res.body.accessToken as string, deviceId };
  };
  const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;

  it('seeded the master catalogue and the demo items', async () => {
    expect(await prisma.masterProduct.count()).toBeGreaterThanOrEqual(seedMasterRows().length);
    expect(await prisma.item.count({ where: { merchantId: kirana.id } })).toBeGreaterThanOrEqual(40);
  });

  it('ACCEPTANCE: 50 barcode scans resolve ≥80% against the seeded master data (Postgres)', async () => {
    const owner = await signIn(kirana.ownerPhone.replace('+91', ''));
    const seeded = seedMasterRows().filter((_, i) => i % 5 === 1).slice(0, 42).map((r) => r.barcode);
    const unknown = Array.from({ length: 5 }, (_, i) => withCheckDigit(`8909998${String(randomInt(1e5)).padStart(5, '0')}`.slice(0, 11) + i));
    const codes = [...seeded, ...MOCK_BARCODE_HITS.map((h) => h.barcode), ...unknown];
    let resolved = 0;
    for (const code of codes) if ((await http().get(`/v1/catalogue/barcodes/${code}`).set(auth(owner))).status === 200) resolved++;
    expect(codes).toHaveLength(50);
    expect(resolved).toBe(45);
    expect(await prisma.barcodeRequest.count({ where: { barcode: { in: unknown }, status: 'open' } })).toBe(5);
    expect(await prisma.masterProduct.count({ where: { source: 'open_barcode' } })).toBeGreaterThanOrEqual(3);
  });

  it('search through Typesense: synonyms, Telugu transliteration and script, typos, grouped by store', async () => {
    const at = q(centre('dargamitta'));
    expect(items((await http().get(`/v1/search?${at}&q=biyyam`).expect(200)).body)).toContain('Annapoorna Sona Masoori Rice');
    expect(items((await http().get(`/v1/search?${at}&q=pappu`).expect(200)).body)).toEqual(expect.arrayContaining(['Annapoorna Toor Dal']));
    expect(items((await http().get(`/v1/search?${at}&q=${encodeURIComponent('బియ్యం')}`).expect(200)).body)).toContain('Annapoorna Sona Masoori Rice');
    const bn = q(centre('balaji-nagar'));
    const tomato = (await http().get(`/v1/search?${bn}&q=tomoto`).expect(200)).body;
    expect(tomato.groups.map((g: { store: { name: string } }) => g.store.name)).toContain('Balaji Fruits & Vegetables');
  });

  it('home feed shows seeded stores with ETA chips', async () => {
    const r = await http().get(`/v1/feed?${q(centre('dargamitta'))}`).expect(200);
    const ramesh = r.body.stores.find((s: { name: string }) => s.name === 'Ramesh Stores');
    expect(ramesh.eta).toMatchObject({ mode: 'asap', minMin: expect.any(Number), maxMin: expect.any(Number) });
    const k = await http().get(`/v1/feed?${q(centre('dargamitta'))}&tab=home_kitchens`).expect(200);
    expect(k.body.stores[0]).toMatchObject({ name: "Saraswathi's Kitchen", eta: { mode: 'scheduled' } });
  });

  it('a new item reaches Typesense through outbox → BullMQ → indexer', async () => {
    const owner = await signIn(kirana.ownerPhone.replace('+91', ''));
    const name = `Pesara Pindi ${randomInt(1e6)}`;
    await http()
      .post('/v1/merchants/me/items')
      .set(auth(owner))
      .send({ name, categorySlug: 'staples', foodMark: 'veg', variants: [{ label: '500 g', unit: 'g', unitQty: 500, pricePaise: 6500 }] })
      .expect(201);
    const t0 = Date.now();
    let found = false;
    while (!found && Date.now() - t0 < 15_000) {
      const r = await http().get(`/v1/search?${q(centre('dargamitta'))}&q=${encodeURIComponent(name)}`).expect(200);
      found = items(r.body).includes(name);
      if (!found) await sleep(200);
    }
    expect(found).toBe(true);
  });

  it('ACCEPTANCE: search p95 < 400 ms with 20k items in Typesense', async () => {
    const index = app.get(SearchIndex);
    const mm = centre('magunta-layout');
    const feed = await http().get(`/v1/feed?${q(mm)}`).expect(200);
    const microMarketId: string = feed.body.serviceability.microMarket.id;
    const brands = ['Annapoorna', 'Godavari Gold', 'Penna Valley', 'Krishna', 'Swarna', 'Kaveri', 'Nellore Fresh', 'Sri Venkateswara'];
    const products = ['Sona Masoori Rice', 'Chakki Atta', 'Toor Dal', 'Moong Dal', 'Sunflower Oil', 'Groundnut Oil', 'Turmeric Powder', 'Red Chilli Powder', 'Toned Milk', 'Curd', 'Paneer', 'Tea Powder', 'Filter Coffee', 'Glucose Biscuits', 'Potato Chips', 'Detergent Powder', 'Bath Soap', 'Shampoo', 'Toothpaste', 'Agarbatti', 'Jaggery', 'Sugar', 'Iodised Salt', 'Tamarind', 'Poha'];
    const packs = ['100 g', '200 g', '500 g', '1 kg', '5 kg', '500 ml', '1 l'];
    for (let s = 0; s < 100; s++) {
      const id = `99999999-0000-4000-8000-${String(s).padStart(12, '0')}`;
      const loc = { lat: mm.lat + ((s % 10) - 5) * 0.0012, lng: mm.lng + (Math.floor(s / 10) - 5) * 0.0012 };
      const merchant: MerchantDoc = {
        id, microMarketId, name: `Synthetic Store ${s}`, nameTe: null, type: 'retail', category: 'kirana', description: null, location: loc,
        radiusM: 5000, hours: everyDay('00:00', '23:59'), selfDelivers: false, photoUrl: null, hasSlots: false, itemCount: 200, staleItemCount: 0,
        catalogueUpdatedAt: Date.now(), movPaise: 0, hygieneDeclared: false, rating: null, ratingCount: 0, acceptanceRate: null, prepP50Min: null,
      };
      const docs: ItemDoc[] = Array.from({ length: 200 }, (_, k) => ({
        id: `99999999-1111-4000-8000-${String(s * 200 + k).padStart(12, '0')}`,
        merchantId: id, microMarketId, merchantName: merchant.name, merchantType: 'retail',
        name: `${brands[(s + k) % brands.length]} ${products[k % products.length]} ${packs[(k + s) % packs.length]}`,
        nameTe: null, brand: brands[(s + k) % brands.length]!, categorySlug: 'staples', categoryName: 'Atta, rice & dal', categoryNameTe: 'అట్టా, బియ్యం & పప్పులు',
        foodMark: 'veg', inStock: k % 13 !== 0, stale: false, pricePaise: 1000 + k, mrpPaise: null, variantCount: 1, imageUrl: null, madeToOrder: false, specialOn: null, location: loc,
      }));
      await index.replaceMerchant(merchant, docs);
    }
    expect((await index.counts()).items).toBeGreaterThanOrEqual(20_000);

    const queries = ['rice', 'biyyam', 'atta', 'toor dal', 'pappu', 'sunflower oil', 'milk', 'paalu', 'curd', 'tea', 'chai', 'biscuits', 'chips', 'soap', 'shampoo', 'masori', 'tumeric', 'groundnut', 'godavari', 'krishna sugar', 'salt', 'uppu', 'tamarind', 'jaggery 1 kg', 'poha', 'coffee', 'paneer', 'agarbatti', 'detergent', 'toothpaste'];
    const times: number[] = [];
    for (let round = 0; round < 5; round++)
      for (const text of queries) {
        const t0 = performance.now();
        const r = await http().get(`/v1/search?${q(mm)}&q=${encodeURIComponent(text)}`).expect(200);
        times.push(performance.now() - t0);
        expect(r.body.zeroResult).toBe(false);
      }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(`Typesense search over 20k items: p50 ${times[Math.floor(times.length / 2)]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(400);
    for (let s = 0; s < 100; s++) await index.removeMerchant(`99999999-0000-4000-8000-${String(s).padStart(12, '0')}`);
  }, 300_000);

  it('ACCEPTANCE: staleness flag after 72 h (clock override), cleared by the daily confirm', async () => {
    const ops = await opsSignIn();
    offsetMs = 73 * 3600_000;
    const sweep = await http().post('/v1/ops/catalogue/staleness-sweep').set(auth(ops)).expect(200);
    expect(sweep.body.flagged).toBeGreaterThan(100);
    expect(await prisma.item.count({ where: { merchantId: kirana.id, staleSince: { not: null } } })).toBeGreaterThan(40);
    const events = await prisma.outboxEvent.count({ where: { type: 'item.stale_flagged' } });
    expect(events).toBeGreaterThanOrEqual(sweep.body.flagged);

    const owner = await signIn(kirana.ownerPhone.replace('+91', ''));
    await http().post('/v1/merchants/me/items/confirm').set(auth(owner)).expect(200);
    expect(await prisma.item.count({ where: { merchantId: kirana.id, staleSince: { not: null }, deletedAt: null } })).toBe(0);
    offsetMs = 0;
  });
});
