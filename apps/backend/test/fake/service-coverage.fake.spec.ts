/**
 * Service coverage (ADR-019, fake mode): why an address is not deliverable, and what ops can change.
 * - /serviceability says why (outside every area) and names the nearest served area;
 * - city-wide coverage (ops, audited): an address outside every area is served by the nearest area of the
 *   city within maxDistanceM;
 * - the store page says why a store does not deliver here (other area / beyond its radius);
 * - ops set a store's delivery radius (audited, reindexed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS, SEED_OUTSIDE_POINT } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!; // Dargamitta, 3 km radius
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!;
const out = SEED_OUTSIDE_POINT; // ~3.5 km from Magunta Layout, the nearest area
const at = (p: { lat: number; lng: number }) => `lat=${p.lat}&lng=${p.lng}`;

describe('Service coverage (fake mode)', () => {
  let fake: FakeApp;
  let ops: Session;
  let cityId: string;
  const http = () => fake.http();
  const setCoverage = (body: object, s: Session = ops) => http().put(`/v1/ops/cities/${cityId}/coverage`).set(s.headers).send(body);

  beforeAll(async () => {
    fake = await bootFakeApp();
    ops = await fake.opsSignIn();
    cityId = (await http().get('/v1/ops/micro-markets').set(ops.headers).expect(200)).body.cities[0].id;
  }, 60_000);
  afterAll(() => fake?.close());

  it('outside every area: not serviceable, says why and names the nearest area', async () => {
    const r = (await http().get(`/v1/serviceability?${at(out)}`).expect(200)).body;
    expect(r).toMatchObject({ serviceable: false, microMarket: null, matchedBy: null, reason: 'outside_service_area' });
    expect(r.nearest.name).toBe('Magunta Layout');
    expect(r.nearest.distanceM).toBeGreaterThan(3000);
    expect(r.nearest.distanceM).toBeLessThan(4000);
    const inside = (await http().get(`/v1/serviceability?${at(dargamitta.centre)}`).expect(200)).body;
    expect(inside).toMatchObject({ serviceable: true, matchedBy: 'area', reason: null, nearest: null });
  });

  it('city-wide coverage: ops switch it on, the nearest area serves within the distance; audited', async () => {
    const before = (await http().get('/v1/ops/micro-markets').set(ops.headers).expect(200)).body.cities[0].coverage;
    expect(before).toEqual({ nearestFallback: false, maxDistanceM: 5000 });
    await setCoverage({ nearestFallback: true, maxDistanceM: 100 }).expect(400); // below 500 m
    const consumer = await fake.signIn('9876504001', 'consumer');
    await setCoverage({ nearestFallback: true, maxDistanceM: 5000 }, consumer).expect(403);

    // Too short a reach: still not served.
    await setCoverage({ nearestFallback: true, maxDistanceM: 2000 }).expect(200);
    expect((await http().get(`/v1/serviceability?${at(out)}`).expect(200)).body.serviceable).toBe(false);

    const city = (await setCoverage({ nearestFallback: true, maxDistanceM: 5000 }).expect(200)).body;
    expect(city.coverage).toEqual({ nearestFallback: true, maxDistanceM: 5000 });
    const r = (await http().get(`/v1/serviceability?${at(out)}`).expect(200)).body;
    expect(r).toMatchObject({ serviceable: true, matchedBy: 'nearest', reason: null, microMarket: { slug: 'magunta-layout' } });
    // The feed now works there (stores of the nearest area, within their own radius).
    const feed = (await http().get(`/v1/feed?${at(out)}&tab=stores`).expect(200)).body;
    expect(feed.serviceability.serviceable).toBe(true);

    const audit = (await http().get(`/v1/ops/audit?entity=city&entityId=${cityId}`).set(ops.headers).expect(200)).body.items as Array<{ action: string; after: unknown }>;
    expect(audit[0]).toMatchObject({ action: 'coverage_changed', after: { nearestFallback: true, maxDistanceM: 5000 } });

    await setCoverage({ nearestFallback: false, maxDistanceM: 5000 }).expect(200);
    expect((await http().get(`/v1/serviceability?${at(out)}`).expect(200)).body.serviceable).toBe(false);
  });

  it('store page: outside every area it does not deliver; beyond the radius ops set it costs more (audited, ADR-022)', async () => {
    // Area borders do not limit delivery (ADR-021): Magunta Layout is within the kirana's 5 km.
    const magunta = SEED_MICRO_MARKETS.find((m) => m.slug === 'magunta-layout')!.centre;
    let page = (await http().get(`/v1/stores/${kirana.id}?${at(magunta)}`).expect(200)).body;
    expect(page).toMatchObject({ deliversHere: true, notDeliveringReason: null, deliveryRadiusM: 7000, beyondRadiusSurchargePaise: null, store: { deliverable: true, beyondRadius: false } });
    page = (await http().get(`/v1/stores/${kirana.id}?${at(out)}`).expect(200)).body;
    expect(page.notDeliveringReason).toBe('outside_service_area');

    const far = { lat: 14.447, lng: 80.003 }; // Dargamitta, ~1.4 km from the store
    page = (await http().get(`/v1/stores/${kirana.id}?${at(far)}`).expect(200)).body;
    expect(page).toMatchObject({ deliversHere: true, notDeliveringReason: null });

    await http().put(`/v1/ops/merchants/${kirana.id}/radius`).set(ops.headers).send({ radiusM: 100, reason: 'test' }).expect(400);
    await http().put(`/v1/ops/merchants/${kirana.id}/radius`).set(ops.headers).send({ radiusM: 1000 }).expect(400); // reason required
    const v = (await http().put(`/v1/ops/merchants/${kirana.id}/radius`).set(ops.headers).send({ radiusM: 1000, reason: 'Only one delivery boy' }).expect(200)).body;
    expect(v.merchant.radiusM).toBe(1000);
    page = (await http().get(`/v1/stores/${kirana.id}?${at(far)}`).expect(200)).body;
    expect(page).toMatchObject({ deliversHere: true, notDeliveringReason: null, deliveryRadiusM: 1000, beyondRadiusSurchargePaise: 3000, store: { beyondRadius: true } });
    const audit = (await http().get(`/v1/ops/audit?entity=merchant&entityId=${kirana.id}`).set(ops.headers).expect(200)).body.items as Array<{ action: string; before: unknown; after: unknown }>;
    expect(audit[0]).toMatchObject({ action: 'radius_changed', before: { radiusM: 7000 }, after: { radiusM: 1000, reason: 'Only one delivery boy' } });
    await http().put(`/v1/ops/merchants/${kirana.id}/radius`).set(ops.headers).send({ radiusM: 7000, reason: 'back to normal' }).expect(200);
  });
});
