/**
 * M6 on real Redis: rider positions live in a Redis GEO set (architecture), searched by radius,
 * nearest first, and stale positions are ignored. The dispatch flow itself is covered in fake mode and
 * the Postgres repository contract (repositories.int.spec.ts).
 */
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSITION_FRESH_SEC, RedisRiderLocations } from '../../src/modules/dispatch-tracking/rider-locations';

const store = { lat: 14.4545, lng: 79.992 };
const north = (m: number) => ({ lat: store.lat + m / 111_195, lng: store.lng });

describe('M6 · rider positions in Redis GEO', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let locations: RedisRiderLocations;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());
    locations = new RedisRiderLocations(redis);
  }, 120_000);
  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  it('finds riders within the radius, nearest first, with distances; ignores stale and removed riders', async () => {
    const now = new Date();
    await locations.set('near', north(300), now);
    await locations.set('far', north(2_000), now);
    await locations.set('out', north(9_000), now);
    await locations.set('stale', north(100), new Date(now.getTime() - (POSITION_FRESH_SEC + 5) * 1000));
    const found = await locations.near(store, 5_000, now);
    expect(found.map((r) => r.riderId)).toEqual(['near', 'far']);
    expect(found[0]!.distanceM).toBeGreaterThan(280);
    expect(found[0]!.distanceM).toBeLessThan(320);
    expect((await locations.get('near'))?.lat).toBeCloseTo(north(300).lat, 5);

    await locations.remove('near');
    expect((await locations.near(store, 5_000, now)).map((r) => r.riderId)).toEqual(['far']);
    expect((await locations.all(now)).map((r) => r.riderId).sort()).toEqual(['far', 'out']);
  });
});
