import { randomUUID } from 'node:crypto';
import { covers, distanceToPolygonMeters, type GeoPolygon, interiorsOverlap, type LatLng, roundPolygon } from '../../common/geo/polygon';
import { DEFAULT_COVERAGE } from './domain/micro-market-config';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { MemoryStore } from '../../infra/fake/memory-tx';
import {
  type CityRecord,
  type Effective,
  type MicroMarketRecord,
  MicroMarketRepository,
  type MicroMarketTx,
  type OverlapHit,
  type VersionRecord,
} from './micro-markets.repository';

interface State {
  cities: CityRecord[];
  markets: MicroMarketRecord[];
  versions: VersionRecord[];
}

const isEffective = (v: VersionRecord, at: Date) =>
  v.effectiveFrom.getTime() <= at.getTime() && (v.effectiveTo === null || v.effectiveTo.getTime() > at.getTime());

/** In-memory MicroMarketRepository (fake mode + tests); geometry via common/geo/polygon. */
export class InMemoryMicroMarketRepository extends MicroMarketRepository {
  private readonly store: Store;

  constructor(sinks?: FakeSinks) {
    super();
    this.store = new Store(sinks);
  }

  transaction<T>(fn: (tx: MicroMarketTx) => Promise<T>): Promise<T> {
    return this.store.tx(fn);
  }

  async listCities(): Promise<CityRecord[]> {
    return this.store.read((s) => [...s.cities].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async findCityBySlug(slug: string): Promise<CityRecord | null> {
    return this.store.read((s) => s.cities.find((c) => c.slug === slug) ?? null);
  }

  async getCity(id: string): Promise<CityRecord | null> {
    return this.store.read((s) => s.cities.find((c) => c.id === id) ?? null);
  }

  async list(cityId?: string): Promise<MicroMarketRecord[]> {
    return this.store.read((s) =>
      s.markets.filter((m) => !cityId || m.cityId === cityId).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async get(id: string): Promise<MicroMarketRecord | null> {
    return this.store.read((s) => s.markets.find((m) => m.id === id) ?? null);
  }

  async getBySlug(slug: string): Promise<MicroMarketRecord | null> {
    return this.store.read((s) => s.markets.find((m) => m.slug === slug) ?? null);
  }

  async versions(microMarketId: string): Promise<VersionRecord[]> {
    return this.store.read((s) =>
      s.versions.filter((v) => v.microMarketId === microMarketId).sort((a, b) => a.version - b.version),
    );
  }

  async effectiveAt(at: Date, cityId?: string): Promise<Effective[]> {
    return this.store.read((s) =>
      s.markets
        .filter((m) => !cityId || m.cityId === cityId)
        .flatMap((market) => {
          const version = s.versions.find((v) => v.microMarketId === market.id && isEffective(v, at));
          return version ? [{ market, version }] : [];
        })
        .sort((a, b) => a.market.name.localeCompare(b.market.name)),
    );
  }

  async resolvePoint(pt: LatLng, at: Date): Promise<Effective | null> {
    const all = (await this.effectiveAt(at)).sort((a, b) => a.market.slug.localeCompare(b.market.slug));
    return all.find((e) => covers(e.version.polygon, pt)) ?? null;
  }

  async nearest(pt: LatLng, at: Date): Promise<(Effective & { distanceM: number }) | null> {
    const all = (await this.effectiveAt(at))
      .map((e) => ({ ...e, distanceM: Math.round(distanceToPolygonMeters(e.version.polygon, pt)) }))
      .sort((a, b) => a.distanceM - b.distanceM || a.market.slug.localeCompare(b.market.slug));
    return all[0] ?? null;
  }

  async overlapping(cityId: string, polygon: GeoPolygon, from: Date, excludeMarketId?: string): Promise<OverlapHit[]> {
    polygon = roundPolygon(polygon); // compare at storage precision, like the Prisma store
    return this.store.read((s) =>
      s.versions
        .filter((v) => v.microMarketId !== excludeMarketId)
        .filter((v) => v.effectiveTo === null || v.effectiveTo.getTime() > from.getTime())
        .flatMap((v) => {
          const m = s.markets.find((x) => x.id === v.microMarketId && x.cityId === cityId);
          return m && interiorsOverlap(v.polygon, polygon) ? [{ microMarketId: m.id, slug: m.slug, version: v.version }] : [];
        })
        .sort((a, b) => a.slug.localeCompare(b.slug) || a.version - b.version),
    );
  }
}

class Store extends MemoryStore<State> {
  constructor(sinks?: FakeSinks) {
    super({ cities: [], markets: [], versions: [] }, sinks);
  }

  read<T>(fn: (s: State) => T): T {
    return this.clone(fn(this.state));
  }

  tx<T>(fn: (tx: MicroMarketTx) => Promise<T>): Promise<T> {
    return this.runTx((fx) =>
      fn({
        createCity: async (c) => {
          if (this.state.cities.some((x) => x.slug === c.slug)) throw new Error(`unique: city ${c.slug}`);
          const city: CityRecord = { ...c, coverage: c.coverage ?? DEFAULT_COVERAGE, id: randomUUID() };
          this.state.cities.push(city);
          return this.clone(city);
        },
        updateCityCoverage: async (cityId, coverage) => {
          const c = this.state.cities.find((x) => x.id === cityId);
          if (!c) return null;
          c.coverage = this.clone(coverage);
          return this.clone(c);
        },
        createMarket: async (m) => {
          if (this.state.markets.some((x) => x.slug === m.slug)) throw new Error(`unique: micro-market ${m.slug}`);
          const market = { ...m, id: randomUUID(), createdAt: new Date() };
          this.state.markets.push(market);
          return this.clone(market);
        },
        lockLatestVersion: async (id) => {
          const vs = this.state.versions.filter((v) => v.microMarketId === id).sort((a, b) => b.version - a.version);
          return vs[0] ? this.clone(vs[0]) : null;
        },
        closeVersion: async (versionId, effectiveTo) => {
          const v = this.state.versions.find((x) => x.id === versionId);
          if (v) v.effectiveTo = effectiveTo;
        },
        insertVersion: async (nv) => {
          if (this.state.versions.some((x) => x.microMarketId === nv.microMarketId && x.version === nv.version))
            throw new Error(`unique: version ${nv.version}`);
          const v: VersionRecord = { ...this.clone(nv), polygon: roundPolygon(nv.polygon), id: randomUUID(), effectiveTo: null, createdAt: new Date() };
          this.state.versions.push(v);
          return this.clone(v);
        },
        appendEvent: async (e) => fx.event(e),
        appendAudit: async (a) => fx.audit(a),
      }),
    );
  }
}
