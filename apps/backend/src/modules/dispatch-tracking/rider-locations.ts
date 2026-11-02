import type { Redis } from 'ioredis';
import { type LatLng, haversineM } from './domain/dispatch';

export interface RiderPosition extends LatLng {
  riderId: string;
  at: Date;
}

/** Positions older than this are not used for offers (the app sends one every ~10 s while online). */
export const POSITION_FRESH_SEC = 120;

/**
 * Live rider positions (architecture: Redis GEO sets, not Postgres). One GEO set for the city plus a
 * hash of last-update times; positions are never persisted beyond Redis (privacy, PRD 9).
 */
export abstract class RiderLocations {
  abstract set(riderId: string, p: LatLng, at: Date): Promise<void>;
  abstract get(riderId: string): Promise<RiderPosition | null>;
  /** Riders within radius of a point, nearest first, fresh positions only. */
  abstract near(p: LatLng, radiusM: number, now: Date): Promise<Array<RiderPosition & { distanceM: number }>>;
  abstract remove(riderId: string): Promise<void>;
  abstract all(now: Date): Promise<RiderPosition[]>;
}

const GEO = 'riders:geo';
const SEEN = 'riders:seen';

export class RedisRiderLocations extends RiderLocations {
  constructor(private readonly redis: Redis) {
    super();
  }

  async set(riderId: string, p: LatLng, at: Date) {
    await this.redis
      .multi()
      .geoadd(GEO, p.lng, p.lat, riderId)
      .hset(SEEN, riderId, String(at.getTime()))
      .exec();
  }

  async get(riderId: string) {
    const [pos] = await this.redis.geopos(GEO, riderId);
    const seen = await this.redis.hget(SEEN, riderId);
    if (!pos || !seen) return null;
    return { riderId, lng: Number(pos[0]), lat: Number(pos[1]), at: new Date(Number(seen)) };
  }

  async near(p: LatLng, radiusM: number, now: Date) {
    const rows = (await this.redis.geosearch(
      GEO,
      'FROMLONLAT',
      p.lng,
      p.lat,
      'BYRADIUS',
      radiusM,
      'm',
      'ASC',
      'WITHCOORD',
      'WITHDIST',
    )) as Array<[string, string, [string, string]]>;
    if (rows.length === 0) return [];
    const seen = await this.redis.hmget(SEEN, ...rows.map((r) => r[0]));
    return rows
      .map(([riderId, dist, [lng, lat]], i) => ({
        riderId,
        lat: Number(lat),
        lng: Number(lng),
        distanceM: Math.round(Number(dist)),
        at: new Date(Number(seen[i] ?? 0)),
      }))
      .filter((r) => now.getTime() - r.at.getTime() <= POSITION_FRESH_SEC * 1000);
  }

  async remove(riderId: string) {
    await this.redis.multi().zrem(GEO, riderId).hdel(SEEN, riderId).exec();
  }

  async all(now: Date) {
    const ids = await this.redis.zrange(GEO, 0, -1);
    const out: RiderPosition[] = [];
    for (const id of ids) {
      const p = await this.get(id);
      if (p && now.getTime() - p.at.getTime() <= POSITION_FRESH_SEC * 1000) out.push(p);
    }
    return out;
  }
}

/** Fake mode: a map and haversine. */
export class MemoryRiderLocations extends RiderLocations {
  private readonly map = new Map<string, RiderPosition>();

  async set(riderId: string, p: LatLng, at: Date) {
    this.map.set(riderId, { riderId, lat: p.lat, lng: p.lng, at });
  }

  async get(riderId: string) {
    const p = this.map.get(riderId);
    return p ? { ...p } : null;
  }

  async near(p: LatLng, radiusM: number, now: Date) {
    return [...this.map.values()]
      .filter((r) => now.getTime() - r.at.getTime() <= POSITION_FRESH_SEC * 1000)
      .map((r) => ({ ...r, distanceM: Math.round(haversineM(r, p)) }))
      .filter((r) => r.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM || a.riderId.localeCompare(b.riderId));
  }

  async remove(riderId: string) {
    this.map.delete(riderId);
  }

  async all(now: Date) {
    return [...this.map.values()]
      .filter((r) => now.getTime() - r.at.getTime() <= POSITION_FRESH_SEC * 1000)
      .map((r) => ({ ...r }));
  }
}
