import { Injectable } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import type { LatLng } from '../../common/geo/polygon';
import { KvCache } from '../../infra/cache/kv-cache';
import { MapsProvider, type Route } from '../../infra/providers/maps/maps.provider';
import type { Discovery } from '../analytics-config/domain/micro-market-config';
import type { MerchantDoc } from './domain/documents';
import { etaRange } from './domain/ranking';

/** H3 resolution 9 (~0.1 km² cells): one cached route per store-cell → customer-cell pair. */
export const H3_RES = 9;
export const TRAVEL_TTL_SEC = 24 * 3600;

export interface Eta {
  etaMin: number;
  minMin: number;
  maxMin: number;
  prepMin: number;
  travelMin: number;
  bufferMin: number;
  distanceM: number;
}

/**
 * ETA v1 (PRD FR-LOC-3, tech plan 7.5): prep p50 + travel (routing provider, cached per H3 res-9
 * cell pair) + buffer from config. Prep p50 is the merchant's rolling median once orders exist
 * (M5); until then the per-type default from the micro-market's discovery config.
 */
@Injectable()
export class EtaService {
  constructor(
    private readonly maps: MapsProvider,
    private readonly cache: KvCache,
  ) {}

  async travel(from: LatLng, to: LatLng): Promise<Route> {
    const key = `eta:v1:${latLngToCell(from.lat, from.lng, H3_RES)}:${latLngToCell(to.lat, to.lng, H3_RES)}`;
    const hit = await this.cache.get<Route>(key);
    if (hit) return hit;
    const route = await this.maps.route(from, to);
    await this.cache.set(key, route, TRAVEL_TTL_SEC);
    return route;
  }

  async estimate(m: MerchantDoc, to: LatLng, d: Discovery, bufferMin: number): Promise<Eta> {
    const route = await this.travel(m.location, to);
    const prepMin = m.prepP50Min ?? d.defaultPrepMin[m.type];
    const travelMin = Math.ceil(route.seconds / 60);
    const etaMin = prepMin + travelMin + bufferMin;
    return { etaMin, ...etaRange(etaMin, d.etaRangeMin), prepMin, travelMin, bufferMin, distanceM: route.meters };
  }
}
