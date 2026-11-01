import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type GeoPolygon, type LatLng, roundPolygon } from '../../common/geo/polygon';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { point } from '../../infra/prisma/geo';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import type { MicroMarketConfig } from './domain/micro-market-config';

export interface CityRecord {
  id: string;
  slug: string;
  name: string;
  nameTe: string;
  state: string;
}

export interface MicroMarketRecord {
  id: string;
  cityId: string;
  slug: string;
  name: string;
  nameTe: string;
  createdAt: Date;
}

export interface VersionRecord extends MicroMarketConfig {
  id: string;
  microMarketId: string;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface Effective {
  market: MicroMarketRecord;
  version: VersionRecord;
}

export interface OverlapHit {
  microMarketId: string;
  slug: string;
  version: number;
}

export interface NewVersion extends MicroMarketConfig {
  microMarketId: string;
  version: number;
  effectiveFrom: Date;
  note: string | null;
  createdBy: string | null;
}

/** Writes that must share one transaction (config change + event + audit). */
export interface MicroMarketTx {
  createCity(c: Omit<CityRecord, 'id'>): Promise<CityRecord>;
  createMarket(m: Omit<MicroMarketRecord, 'id' | 'createdAt'>): Promise<MicroMarketRecord>;
  /** Latest version, locking the market row so concurrent publishes serialise. */
  lockLatestVersion(microMarketId: string): Promise<VersionRecord | null>;
  closeVersion(versionId: string, effectiveTo: Date): Promise<void>;
  insertVersion(v: NewVersion): Promise<VersionRecord>;
  appendEvent<P>(e: NewEvent<P>): Promise<void>;
  appendAudit(a: AuditEntry): Promise<void>;
}

/** Storage port for analytics-config micro-markets. Only this module touches these tables. */
export abstract class MicroMarketRepository {
  abstract transaction<T>(fn: (tx: MicroMarketTx) => Promise<T>): Promise<T>;
  abstract listCities(): Promise<CityRecord[]>;
  abstract findCityBySlug(slug: string): Promise<CityRecord | null>;
  abstract list(cityId?: string): Promise<MicroMarketRecord[]>;
  abstract get(id: string): Promise<MicroMarketRecord | null>;
  abstract getBySlug(slug: string): Promise<MicroMarketRecord | null>;
  /** All versions, oldest first. */
  abstract versions(microMarketId: string): Promise<VersionRecord[]>;
  /** The version of every market (optionally in one city) effective at `at`. */
  abstract effectiveAt(at: Date, cityId?: string): Promise<Effective[]>;
  /** The market whose effective polygon covers the point at `at` (ST_Covers). */
  abstract resolvePoint(pt: LatLng, at: Date): Promise<Effective | null>;
  /**
   * Versions of *other* markets in the city, effective at any time from `from` onwards, whose
   * interiors intersect `polygon` (shared edges are fine).
   */
  abstract overlapping(cityId: string, polygon: GeoPolygon, from: Date, excludeMarketId?: string): Promise<OverlapHit[]>;
}

// ── Prisma (PostGIS) ──

const geo = (p: GeoPolygon) => Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(p)}), 4326)::geography`;

interface VersionRow {
  id: string;
  micro_market_id: string;
  version: number;
  effective_from: Date;
  effective_to: Date | null;
  polygon: GeoPolygon;
  hours: MicroMarketConfig['hours'];
  fees: MicroMarketConfig['fees'];
  cod: MicroMarketConfig['cod'];
  sla: MicroMarketConfig['sla'];
  rider_pay: MicroMarketConfig['riderPay'];
  note: string | null;
  created_by: string | null;
  created_at: Date;
}

const VERSION_COLUMNS = Prisma.sql`v.id::text, v.micro_market_id::text, v.version, v.effective_from, v.effective_to,
  ST_AsGeoJSON(v.polygon, 7)::json AS polygon, v.hours, v.fees, v.cod, v.sla, v.rider_pay, v.note,
  v.created_by::text, v.created_at`;

const MARKET_COLUMNS = Prisma.sql`m.id::text AS m_id, m.city_id::text AS m_city_id, m.slug AS m_slug, m.name AS m_name,
  m.name_te AS m_name_te, m.created_at AS m_created_at`;

type JoinedRow = VersionRow & {
  m_id: string;
  m_city_id: string;
  m_slug: string;
  m_name: string;
  m_name_te: string;
  m_created_at: Date;
};

const toVersion = (r: VersionRow): VersionRecord => ({
  id: r.id,
  microMarketId: r.micro_market_id,
  version: r.version,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  // ST_AsGeoJSON may emit extra precision; keep the shape we store.
  polygon: { type: 'Polygon', coordinates: r.polygon.coordinates },
  hours: r.hours,
  fees: r.fees,
  cod: r.cod,
  sla: r.sla,
  riderPay: r.rider_pay,
  note: r.note,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

const toEffective = (r: JoinedRow): Effective => ({
  market: { id: r.m_id, cityId: r.m_city_id, slug: r.m_slug, name: r.m_name, nameTe: r.m_name_te, createdAt: r.m_created_at },
  version: toVersion(r),
});

const effectiveWhere = (at: Date) =>
  Prisma.sql`v.effective_from <= ${at} AND (v.effective_to IS NULL OR v.effective_to > ${at})`;

class PrismaMicroMarketTx implements MicroMarketTx {
  constructor(private readonly tx: Tx) {}

  createCity(c: Omit<CityRecord, 'id'>): Promise<CityRecord> {
    return this.tx.city.create({ data: c, select: { id: true, slug: true, name: true, nameTe: true, state: true } });
  }

  createMarket(m: Omit<MicroMarketRecord, 'id' | 'createdAt'>): Promise<MicroMarketRecord> {
    return this.tx.microMarket.create({ data: m });
  }

  async lockLatestVersion(microMarketId: string): Promise<VersionRecord | null> {
    await this.tx.$queryRaw`SELECT id FROM micro_markets WHERE id = ${microMarketId}::uuid FOR UPDATE`;
    const rows = await this.tx.$queryRaw<VersionRow[]>`
      SELECT ${VERSION_COLUMNS} FROM micro_market_versions v
      WHERE v.micro_market_id = ${microMarketId}::uuid ORDER BY v.version DESC LIMIT 1`;
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async closeVersion(versionId: string, effectiveTo: Date): Promise<void> {
    await this.tx.microMarketVersion.update({ where: { id: versionId }, data: { effectiveTo } });
  }

  async insertVersion(v: NewVersion): Promise<VersionRecord> {
    const json = (x: unknown) => JSON.stringify(x);
    const rows = await this.tx.$queryRaw<VersionRow[]>`
      INSERT INTO micro_market_versions AS v
        (id, micro_market_id, version, effective_from, polygon, hours, fees, cod, sla, rider_pay, note, created_by)
      VALUES (gen_random_uuid(), ${v.microMarketId}::uuid, ${v.version}, ${v.effectiveFrom}, ${geo(roundPolygon(v.polygon))},
        ${json(v.hours)}::jsonb, ${json(v.fees)}::jsonb, ${json(v.cod)}::jsonb, ${json(v.sla)}::jsonb,
        ${json(v.riderPay)}::jsonb, ${v.note}, ${v.createdBy}::uuid)
      RETURNING ${VERSION_COLUMNS}`;
    return toVersion(rows[0]!);
  }

  async appendEvent<P>(e: NewEvent<P>): Promise<void> {
    await appendToOutbox(this.tx, e);
  }

  async appendAudit(a: AuditEntry): Promise<void> {
    await appendAudit(this.tx, a);
  }
}

@Injectable()
export class PrismaMicroMarketRepository extends MicroMarketRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  transaction<T>(fn: (tx: MicroMarketTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaMicroMarketTx(tx)));
  }

  listCities(): Promise<CityRecord[]> {
    return this.prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, slug: true, name: true, nameTe: true, state: true } });
  }

  findCityBySlug(slug: string): Promise<CityRecord | null> {
    return this.prisma.city.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, nameTe: true, state: true } });
  }

  list(cityId?: string): Promise<MicroMarketRecord[]> {
    return this.prisma.microMarket.findMany({ where: { cityId }, orderBy: { name: 'asc' } });
  }

  get(id: string): Promise<MicroMarketRecord | null> {
    return this.prisma.microMarket.findUnique({ where: { id } });
  }

  getBySlug(slug: string): Promise<MicroMarketRecord | null> {
    return this.prisma.microMarket.findUnique({ where: { slug } });
  }

  async versions(microMarketId: string): Promise<VersionRecord[]> {
    const rows = await this.prisma.$queryRaw<VersionRow[]>`
      SELECT ${VERSION_COLUMNS} FROM micro_market_versions v
      WHERE v.micro_market_id = ${microMarketId}::uuid ORDER BY v.version`;
    return rows.map(toVersion);
  }

  async effectiveAt(at: Date, cityId?: string): Promise<Effective[]> {
    const rows = await this.prisma.$queryRaw<JoinedRow[]>`
      SELECT ${VERSION_COLUMNS}, ${MARKET_COLUMNS}
      FROM micro_market_versions v JOIN micro_markets m ON m.id = v.micro_market_id
      WHERE ${effectiveWhere(at)} ${cityId ? Prisma.sql`AND m.city_id = ${cityId}::uuid` : Prisma.empty}
      ORDER BY m.name`;
    return rows.map(toEffective);
  }

  async resolvePoint(pt: LatLng, at: Date): Promise<Effective | null> {
    const rows = await this.prisma.$queryRaw<JoinedRow[]>`
      SELECT ${VERSION_COLUMNS}, ${MARKET_COLUMNS}
      FROM micro_market_versions v JOIN micro_markets m ON m.id = v.micro_market_id
      WHERE ${effectiveWhere(at)} AND ST_Covers(v.polygon, ${point(pt)})
      ORDER BY m.slug LIMIT 1`;
    return rows[0] ? toEffective(rows[0]) : null;
  }

  async overlapping(cityId: string, polygon: GeoPolygon, from: Date, excludeMarketId?: string): Promise<OverlapHit[]> {
    // 'T********' = interiors intersect (DE-9IM); touching edges or corners do not match.
    return this.prisma.$queryRaw<OverlapHit[]>`
      SELECT m.id::text AS "microMarketId", m.slug, v.version
      FROM micro_market_versions v JOIN micro_markets m ON m.id = v.micro_market_id
      WHERE m.city_id = ${cityId}::uuid
        ${excludeMarketId ? Prisma.sql`AND m.id <> ${excludeMarketId}::uuid` : Prisma.empty}
        AND (v.effective_to IS NULL OR v.effective_to > ${from})
        AND ST_Relate(v.polygon::geometry, ${geo(roundPolygon(polygon))}::geometry, 'T********')
      ORDER BY m.slug, v.version`;
  }
}
