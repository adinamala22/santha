/**
 * Local/dev seed. Idempotent — safe to run repeatedly. Refuses to run outside APP_ENV=dev.
 * M0: identities (2 consumers, 3 riders, 12 merchant owners, 1 ops admin with a console login).
 * M1: Nellore, four micro-markets (version 1), 12 demo merchants with KYC and staff.
 * M2: master catalogue (prisma/data/master-products.csv), ~200 items, kitchen slots, store photos.
 * The data lives in src/dev/seed-data.ts so the in-memory fake store (DATA_STORE=memory) matches.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { SEED_CITY, SEED_EFFECTIVE_FROM, SEED_MICRO_MARKETS, SEED_OPS_PASSWORD, SEED_PEOPLE } from '../src/dev/seed-data';
import { buildSeedKyc, buildSeedMerchants } from '../src/dev/seed-records';
import { buildSeedCatalogue, buildSeedMaster, renderStorePhoto, seedStorePhotoRecords } from '../src/dev/seed-catalogue';
import { parseEnv } from '../src/config/env';
import { S3ObjectStorage } from '../src/infra/storage/object-storage';
import { MediaService } from '../src/modules/merchant-catalogue/media.service';
import { DEFAULT_CONFIG } from '../src/modules/analytics-config/domain/micro-market-config';
import { hashPassword } from '../src/modules/identity-kyc/domain/secrets';

const prisma = new PrismaClient();
const json = (v: unknown) => JSON.stringify(v);

async function seedPeople(): Promise<void> {
  const opsHash = hashPassword(SEED_OPS_PASSWORD);
  for (const p of SEED_PEOPLE) {
    const existing = await prisma.user.findUnique({ where: { phone: p.phone } });
    const data = { name: p.name, ...(p.email ? { email: p.email, passwordHash: opsHash } : {}) };
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data })
      : await prisma.user.create({ data: { id: p.id, phone: p.phone, ...data } });
    await prisma.userRole.createMany({ data: p.roles.map((role) => ({ userId: user.id, role })), skipDuplicates: true });
  }
}

async function seedMicroMarkets(): Promise<Map<string, string>> {
  const city = await prisma.city.upsert({ where: { slug: SEED_CITY.slug }, create: { ...SEED_CITY }, update: {} });
  const ids = new Map<string, string>();
  for (const m of SEED_MICRO_MARKETS) {
    const market = await prisma.microMarket.upsert({
      where: { slug: m.slug },
      create: { cityId: city.id, slug: m.slug, name: m.name, nameTe: m.nameTe },
      update: {},
    });
    ids.set(m.slug, market.id);
    const has = await prisma.microMarketVersion.count({ where: { microMarketId: market.id } });
    if (has === 0)
      await prisma.$executeRaw`
        INSERT INTO micro_market_versions (id, micro_market_id, version, effective_from, polygon, hours, fees, cod, sla, rider_pay, note)
        VALUES (gen_random_uuid(), ${market.id}::uuid, 1, ${SEED_EFFECTIVE_FROM},
          ST_SetSRID(ST_GeomFromGeoJSON(${json(m.polygon)}), 4326)::geography,
          ${json(DEFAULT_CONFIG.hours)}::jsonb, ${json(DEFAULT_CONFIG.fees)}::jsonb, ${json(DEFAULT_CONFIG.cod)}::jsonb,
          ${json(DEFAULT_CONFIG.sla)}::jsonb, ${json(DEFAULT_CONFIG.riderPay)}::jsonb, 'Seeded approximate area')`;
  }
  return ids;
}

async function seedMerchants(marketIds: Map<string, string>): Promise<number> {
  const seed = buildSeedMerchants(marketIds);
  const kyc = buildSeedKyc();
  for (const m of seed.merchants) {
    const owner = SEED_PEOPLE.find((p) => p.id === m.ownerUserId)!;
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { phone: owner.phone } });
    const existing = await prisma.merchant.findUnique({ where: { ownerUserId: ownerRow.id } });
    if (existing) {
      // Keep local edits; only backfill store photos for databases seeded before M2.
      if (!existing.photoIds.length && m.photoIds.length) await prisma.merchant.update({ where: { id: existing.id }, data: { photoIds: m.photoIds } });
      continue;
    }
    const { location, hours, ...rest } = m;
    await prisma.merchant.create({ data: { ...rest, ownerUserId: ownerRow.id, hours: hours as Prisma.InputJsonValue } });
    if (location)
      await prisma.$executeRaw`UPDATE merchants SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography WHERE id = ${m.id}::uuid`;
    for (const s of seed.staff.filter((x) => x.merchantId === m.id)) await prisma.merchantStaff.create({ data: s });
    for (const k of kyc.filter((x) => x.merchantId === m.id))
      await prisma.kycCheck.create({
        data: {
          ...k.check,
          details: k.check.details ? (k.check.details as Prisma.InputJsonValue) : Prisma.JsonNull,
          subjectType: 'merchant',
          subjectId: m.id,
        },
      });
  }
  return seed.merchants.length;
}

async function seedCatalogue(): Promise<{ master: number; items: number }> {
  const now = new Date();
  const master = buildSeedMaster(now);
  for (const m of master) {
    const { id, createdAt: _c, updatedAt: _u, ...data } = m;
    await prisma.masterProduct.upsert({ where: { barcode: m.barcode }, create: { id, ...data }, update: {} });
  }
  const merchants = await prisma.merchant.findMany({ select: { id: true, microMarketId: true } });
  const market = new Map(merchants.map((m) => [m.id, m.microMarketId]));
  const cat = buildSeedCatalogue(now, (id) => market.get(id) ?? null);
  let items = 0;
  for (const i of cat.items) {
    if (!market.has(i.merchantId) || (await prisma.item.findUnique({ where: { id: i.id } }))) continue; // keep local edits
    const { variants, ...data } = i;
    await prisma.item.create({ data: { ...data, variants: { create: variants.map(({ itemId: _i, ...v }) => v) } } });
    items++;
  }
  for (const s of cat.slots) if (market.has(s.merchantId)) await prisma.kitchenSlot.upsert({ where: { id: s.id }, create: s, update: {} });
  return { master: master.length, items };
}

/** Store photos: rendered tiles uploaded to S3/RustFS (best effort — rows are created either way). */
async function seedStorePhotos(): Promise<void> {
  const env = parseEnv(process.env);
  const storage = new S3ObjectStorage(env);
  const media = new MediaService(null as never, storage, env, () => new Date());
  let uploaded = 0;
  for (const r of seedStorePhotoRecords(new Date())) {
    if (await prisma.media.findUnique({ where: { id: r.id } })) continue;
    const { storeName, storeType, variants: _v, ...row } = r;
    let variants: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
    try {
      variants = (await media.render(await renderStorePhoto(storeName, storeType), `media/${r.merchantId}/${r.id}`)) as unknown as Prisma.InputJsonValue;
      uploaded++;
    } catch (err) {
      if (uploaded === 0) console.warn(`Store photos not uploaded (is RustFS up? ${err instanceof Error ? err.message : String(err)})`);
    }
    await prisma.media.create({ data: { ...row, variants } });
  }
}

async function main(): Promise<void> {
  if ((process.env.APP_ENV ?? 'dev') !== 'dev') throw new Error('The demo seed only runs with APP_ENV=dev');
  await seedPeople();
  const marketIds = await seedMicroMarkets();
  const merchants = await seedMerchants(marketIds);
  const catalogue = await seedCatalogue();
  await seedStorePhotos();
  console.log(`Seeded ${SEED_PEOPLE.length} users, ${marketIds.size} micro-markets, ${merchants} merchants, ${catalogue.master} master products, ${catalogue.items} new items.`);
  console.log('Ops console: admin@santha.local / SEED_OPS_PASSWORD (default santha-admin-dev), OTP 123456');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
