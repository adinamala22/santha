/**
 * M1 acceptance (fake mode): "micro-market edits are versioned and reflected in serviceability
 * within 60 s; audit rows exist for every ops action" — plus ops sign-in and access control.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rect } from '../../src/common/geo/polygon';
import { SEED_MICRO_MARKETS, SEED_OUTSIDE_POINT } from '../../src/dev/seed-data';
import { DEFAULT_CONFIG } from '../../src/modules/analytics-config/domain/micro-market-config';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const at = (p: { lat: number; lng: number }) => `/v1/serviceability?lat=${p.lat}&lng=${p.lng}`;

describe('M1 · micro-markets in fake mode', () => {
  let fake: FakeApp;
  let ops: Session;

  beforeAll(async () => {
    fake = await bootFakeApp();
    ops = await fake.opsSignIn();
  });

  afterAll(async () => {
    await fake.close();
  });

  describe('ops sign-in (email + password + OTP)', () => {
    it('gives the seeded admin a web_admin session with ops roles', () => {
      expect(ops.user.roles).toEqual(expect.arrayContaining(['admin', 'ops']));
    });

    it('rejects a wrong password or unknown email with the same error', async () => {
      for (const body of [
        { email: 'admin@santha.local', password: 'wrong-password' },
        { email: 'nobody@santha.local', password: 'santha-admin-dev' },
      ]) {
        const res = await fake.http().post('/v1/auth/ops/login').send({ ...body, deviceId: 'ops-console-x1' }).expect(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('keeps app users out of ops endpoints', async () => {
      const merchant = await fake.signIn(fake.seeded('merchant').phone, 'merchant');
      const res = await fake.http().get('/v1/ops/micro-markets').set(merchant.headers).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await fake.http().get('/v1/ops/micro-markets').expect(401);
    });
  });

  it('lists the four seeded Nellore micro-markets at version 1', async () => {
    const res = await fake.http().get('/v1/ops/micro-markets').set(ops.headers).expect(200);
    expect(res.body.cities).toEqual([expect.objectContaining({ slug: 'nellore', nameTe: 'నెల్లూరు' })]);
    expect(res.body.items.map((m: { slug: string }) => m.slug).sort()).toEqual(SEED_MICRO_MARKETS.map((m) => m.slug).sort());
    expect(res.body.items.every((m: { currentVersion: number }) => m.currentVersion === 1)).toBe(true);
  });

  it('serviceability: inside a polygon vs outside (with waitlist CTA)', async () => {
    const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!;
    const inside = await fake.http().get(at(dargamitta.centre)).expect(200);
    expect(inside.body).toMatchObject({ serviceable: true, microMarket: { slug: 'dargamitta', nameTe: 'దర్గామిట్ట' } });
    const outside = await fake.http().get(at(SEED_OUTSIDE_POINT)).expect(200);
    expect(outside.body).toMatchObject({ serviceable: false, microMarket: null, waitlist: true, matchedBy: null, reason: 'outside_service_area' });
  });

  it('a new micro-market is serviceable immediately and audited', async () => {
    const polygon = rect(79.975, 14.46, 79.995, 14.475); // Stonehousepet, north of Magunta/Dargamitta (shares an edge)
    const point = { lat: 14.468, lng: 79.985 };
    expect((await fake.http().get(at(point))).body.serviceable).toBe(false);

    const res = await fake
      .http()
      .post('/v1/ops/micro-markets')
      .set(ops.headers)
      .send({ citySlug: 'nellore', slug: 'stonehousepet', name: 'Stonehousepet', nameTe: 'స్టోన్‌హౌస్‌పేట', config: { ...DEFAULT_CONFIG, polygon } })
      .expect(201);
    expect(res.body).toMatchObject({ slug: 'stonehousepet', current: { version: 1, effectiveTo: null } });

    expect((await fake.http().get(at(point))).body.microMarket.slug).toBe('stonehousepet');

    const audit = await fake.http().get(`/v1/ops/audit?entity=micro_market&entityId=${res.body.id}`).set(ops.headers).expect(200);
    expect(audit.body.items).toEqual([expect.objectContaining({ action: 'created', actorId: ops.user.id })]);
  });

  it('rejects overlapping and invalid polygons', async () => {
    const overlapping = rect(79.98, 14.45, 79.99, 14.455); // straddles Magunta Layout and Dargamitta
    const res = await fake
      .http()
      .post('/v1/ops/micro-markets')
      .set(ops.headers)
      .send({ citySlug: 'nellore', slug: 'overlap-test', name: 'Overlap', nameTe: 'ఓవర్‌ల్యాప్', config: { ...DEFAULT_CONFIG, polygon: overlapping } })
      .expect(409);
    expect(res.body.error.code).toBe('POLYGON_OVERLAP');
    expect(res.body.error.message).toMatch(/dargamitta/);
    expect(res.body.error.message).toMatch(/magunta-layout/);

    const bowtie = { type: 'Polygon', coordinates: [[[79.9, 14.3], [79.91, 14.31], [79.91, 14.3], [79.9, 14.31], [79.9, 14.3]]] };
    const bad = await fake
      .http()
      .post('/v1/ops/micro-markets')
      .set(ops.headers)
      .send({ citySlug: 'nellore', slug: 'bowtie', name: 'Bowtie', nameTe: 'బో', config: { ...DEFAULT_CONFIG, polygon: bowtie } })
      .expect(422);
    expect(bad.body.error.code).toBe('POLYGON_INVALID');
  });

  describe('versioning', () => {
    const slug = 'vedayapalem';
    let id: string;
    const grown = rect(79.955, 14.395, 79.975, 14.425); // extends 0.01° south
    const southPoint = { lat: 14.4, lng: 79.965 };

    beforeAll(async () => {
      const list = await fake.http().get('/v1/ops/micro-markets').set(ops.headers);
      id = list.body.items.find((m: { slug: string }) => m.slug === slug).id;
    });

    it('publishing a new version closes the previous one and changes serviceability at once', async () => {
      expect((await fake.http().get(at(southPoint))).body.serviceable).toBe(false);
      const v2 = await fake
        .http()
        .post(`/v1/ops/micro-markets/${id}/versions`)
        .set(ops.headers)
        .send({ config: { ...DEFAULT_CONFIG, polygon: grown }, note: 'Include Vedayapalem south colony' })
        .expect(201);
      expect(v2.body).toMatchObject({ version: 2, effectiveTo: null, note: 'Include Vedayapalem south colony' });

      // "reflected in serviceability within 60 s" — here: on the very next request.
      expect((await fake.http().get(at(southPoint))).body.microMarket?.slug).toBe(slug);

      const detail = await fake.http().get(`/v1/ops/micro-markets/${id}`).set(ops.headers).expect(200);
      expect(detail.body.current.version).toBe(2);
      expect(detail.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
      expect(detail.body.versions[0].effectiveTo).toBe(v2.body.effectiveFrom); // v1 closed exactly when v2 starts
    });

    it('a future-dated version is scheduled, not applied', async () => {
      const inOneHour = new Date(Date.now() + 3600_000).toISOString();
      const fees = { ...DEFAULT_CONFIG.fees, deliveryBasePaise: 3000 };
      const v3 = await fake
        .http()
        .post(`/v1/ops/micro-markets/${id}/versions`)
        .set(ops.headers)
        .send({ config: { ...DEFAULT_CONFIG, polygon: grown, fees }, effectiveFrom: inOneHour })
        .expect(201);
      expect(v3.body.version).toBe(3);
      const detail = await fake.http().get(`/v1/ops/micro-markets/${id}`).set(ops.headers).expect(200);
      expect(detail.body.current.version).toBe(2);
      expect(detail.body.current.effectiveTo).toBe(v3.body.effectiveFrom);
    });

    it('refuses backdated versions, no-op versions and versions starting before the latest', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const back = await fake
        .http()
        .post(`/v1/ops/micro-markets/${id}/versions`)
        .set(ops.headers)
        .send({ config: { ...DEFAULT_CONFIG, polygon: grown }, effectiveFrom: yesterday })
        .expect(409);
      expect(back.body.error.code).toBe('VERSION_CONFLICT');

      // v3 starts in an hour; "now" is before it
      const early = await fake
        .http()
        .post(`/v1/ops/micro-markets/${id}/versions`)
        .set(ops.headers)
        .send({ config: { ...DEFAULT_CONFIG, polygon: rect(79.955, 14.405, 79.975, 14.425) } })
        .expect(409);
      expect(early.body.error.details.latestVersion).toBe(3);
    });

    it('every publish is audited with the changed sections', async () => {
      const audit = await fake.http().get(`/v1/ops/audit?entity=micro_market&entityId=${id}`).set(ops.headers).expect(200);
      expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(['version_published', 'version_published']);
      expect(audit.body.items[1].after).toMatchObject({ version: 2, changed: ['polygon'] });
      expect(audit.body.items[0].after).toMatchObject({ version: 3, changed: ['fees'] });
    });

    it('only admin/ops may publish', async () => {
      const consumer = await fake.signIn(fake.seeded('consumer').phone, 'consumer');
      await fake
        .http()
        .post(`/v1/ops/micro-markets/${id}/versions`)
        .set(consumer.headers)
        .send({ config: { ...DEFAULT_CONFIG, polygon: grown } })
        .expect(403);
    });
  });

  it('flags are evaluated per user and micro-market', async () => {
    const res = await fake.http().get('/v1/config/flags').set(ops.headers).expect(200);
    expect(res.body.flags).toMatchObject({ merchant_onboarding: true, serviceability_waitlist: true, cod_payments: true });
  });
});
