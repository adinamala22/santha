import { Injectable, Logger } from '@nestjs/common';
import { haversineMeters, type LatLng } from '../../../common/geo/polygon';

export interface Route {
  seconds: number;
  meters: number;
}

/**
 * Routing for ETA travel estimates (tech plan 7.5). `google` = Routes API computeRoutes (live,
 * two-wheeler); `mock` (dev/test/fake mode) = straight-line distance × road factor at town speed.
 * Callers cache results per H3 cell pair, so providers are called rarely.
 */
export abstract class MapsProvider {
  abstract readonly name: string;
  abstract route(from: LatLng, to: LatLng): Promise<Route>;
}

/** Nellore two-wheeler assumptions for the mock: roads are ~1.4× the straight line, 18 km/h door to door. */
export const MOCK_ROAD_FACTOR = 1.4;
export const MOCK_SPEED_KMH = 18;

export function mockRoute(from: LatLng, to: LatLng): Route {
  const meters = Math.round(haversineMeters(from, to) * MOCK_ROAD_FACTOR);
  return { meters, seconds: Math.round((meters / 1000 / MOCK_SPEED_KMH) * 3600) };
}

@Injectable()
export class MockMapsProvider extends MapsProvider {
  readonly name = 'mock';
  async route(from: LatLng, to: LatLng): Promise<Route> {
    return mockRoute(from, to);
  }
}

@Injectable()
export class GoogleRoutesProvider extends MapsProvider {
  readonly name = 'google';
  private readonly logger = new Logger('GoogleRoutes');

  constructor(private readonly apiKey: string) {
    super();
  }

  async route(from: LatLng, to: LatLng): Promise<Route> {
    const wp = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    try {
      const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
        body: JSON.stringify({ origin: wp(from), destination: wp(to), travelMode: 'TWO_WHEELER', routingPreference: 'TRAFFIC_AWARE' }),
        signal: AbortSignal.timeout(2500),
      });
      const body = (await res.json()) as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
      const r = body.routes?.[0];
      if (!res.ok || !r?.duration) throw new Error(`status ${res.status}`);
      return { seconds: Number(r.duration.replace('s', '')), meters: r.distanceMeters ?? 0 };
    } catch (err) {
      // Degrade to the estimate rather than failing the feed; the cache keeps retries rare.
      this.logger.warn(`route failed, using estimate: ${err instanceof Error ? err.message : String(err)}`);
      return mockRoute(from, to);
    }
  }
}
