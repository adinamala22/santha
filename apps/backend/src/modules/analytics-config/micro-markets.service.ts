import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { type LatLng, polygonProblems } from '../../common/geo/polygon';
import { changedFields, type MicroMarketConfig } from './domain/micro-market-config';
import {
  type CityRecord,
  type Effective,
  type MicroMarketRecord,
  MicroMarketRepository,
  type MicroMarketTx,
  type VersionRecord,
} from './micro-markets.repository';

export interface Actor {
  userId: string;
  requestId?: string | null;
}

export interface CreateMicroMarketInput {
  citySlug: string;
  slug: string;
  name: string;
  nameTe: string;
  config: MicroMarketConfig;
  effectiveFrom?: Date | undefined;
  note?: string | undefined;
}

export interface PublishVersionInput {
  config: MicroMarketConfig;
  effectiveFrom?: Date | undefined;
  note?: string | undefined;
}

/** Allowed clock skew between the console and the API when "now" is sent explicitly. */
const BACKDATE_TOLERANCE_MS = 60_000;

/**
 * Micro-market configuration with effective-dated versions (FR-OPS-2). Exported for other modules:
 * `resolve()` answers serviceability and `effective()` gives the config in force at a time.
 * Changes are visible to serviceability immediately (no cache in front of `resolve`).
 */
@Injectable()
export class MicroMarketsService {
  constructor(
    private readonly repo: MicroMarketRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  listCities(): Promise<CityRecord[]> {
    return this.repo.listCities();
  }

  async list(at = this.clock()): Promise<Array<{ market: MicroMarketRecord; current: VersionRecord | null; versionCount: number }>> {
    const [markets, effective] = await Promise.all([this.repo.list(), this.repo.effectiveAt(at)]);
    return Promise.all(
      markets.map(async (market) => ({
        market,
        current: effective.find((e) => e.market.id === market.id)?.version ?? null,
        versionCount: (await this.repo.versions(market.id)).length,
      })),
    );
  }

  async get(id: string): Promise<{ market: MicroMarketRecord; versions: VersionRecord[]; current: VersionRecord | null }> {
    const market = await this.repo.get(id);
    if (!market) throw new DomainError('NOT_FOUND', 'Micro-market not found');
    const versions = await this.repo.versions(id);
    const now = this.clock().getTime();
    const current =
      versions.find((v) => v.effectiveFrom.getTime() <= now && (v.effectiveTo === null || v.effectiveTo.getTime() > now)) ?? null;
    return { market, versions, current };
  }

  /** Serviceability: which micro-market (if any) covers this point right now. */
  resolve(pt: LatLng, at = this.clock()): Promise<Effective | null> {
    return this.repo.resolvePoint(pt, at);
  }

  async effective(microMarketId: string, at = this.clock()): Promise<VersionRecord | null> {
    return (await this.repo.effectiveAt(at)).find((e) => e.market.id === microMarketId)?.version ?? null;
  }

  async create(input: CreateMicroMarketInput, actor: Actor): Promise<{ market: MicroMarketRecord; version: VersionRecord }> {
    const city = await this.repo.findCityBySlug(input.citySlug);
    if (!city) throw new DomainError('NOT_FOUND', `City ${input.citySlug} not found`);
    if (await this.repo.getBySlug(input.slug))
      throw new DomainError('ALREADY_EXISTS', `A micro-market with slug ${input.slug} already exists`);
    const effectiveFrom = this.checkEffectiveFrom(input.effectiveFrom);
    await this.checkPolygon(city.id, input.config, effectiveFrom);

    return this.repo.transaction(async (tx) => {
      const market = await tx.createMarket({ cityId: city.id, slug: input.slug, name: input.name, nameTe: input.nameTe });
      const version = await this.insert(tx, market, null, input.config, effectiveFrom, input.note, actor);
      await tx.appendAudit({
        entity: 'micro_market',
        entityId: market.id,
        action: 'created',
        actorId: actor.userId,
        microMarketId: market.id,
        before: null,
        after: { slug: market.slug, name: market.name, version: 1, effectiveFrom: effectiveFrom.toISOString() },
        requestId: actor.requestId ?? null,
      });
      return { market, version };
    });
  }

  async publishVersion(microMarketId: string, input: PublishVersionInput, actor: Actor): Promise<VersionRecord> {
    const market = await this.repo.get(microMarketId);
    if (!market) throw new DomainError('NOT_FOUND', 'Micro-market not found');
    const effectiveFrom = this.checkEffectiveFrom(input.effectiveFrom);
    await this.checkPolygon(market.cityId, input.config, effectiveFrom, market.id);

    return this.repo.transaction(async (tx) => {
      const latest = await tx.lockLatestVersion(market.id);
      if (latest && effectiveFrom.getTime() <= latest.effectiveFrom.getTime())
        throw new DomainError(
          'VERSION_CONFLICT',
          `The new version must start after version ${latest.version} (${latest.effectiveFrom.toISOString()})`,
          { latestVersion: latest.version },
        );
      const changed = changedFields(latest, input.config);
      if (latest && changed.length === 0)
        throw new DomainError('VALIDATION_FAILED', 'Nothing changed compared with the latest version');
      if (latest) await tx.closeVersion(latest.id, effectiveFrom);
      const version = await this.insert(tx, market, latest, input.config, effectiveFrom, input.note, actor);
      await tx.appendAudit({
        entity: 'micro_market',
        entityId: market.id,
        action: 'version_published',
        actorId: actor.userId,
        microMarketId: market.id,
        before: latest ? { version: latest.version, effectiveTo: null } : null,
        after: { version: version.version, effectiveFrom: effectiveFrom.toISOString(), changed, note: input.note ?? null },
        requestId: actor.requestId ?? null,
      });
      return version;
    });
  }

  private async insert(
    tx: MicroMarketTx,
    market: MicroMarketRecord,
    latest: VersionRecord | null,
    config: MicroMarketConfig,
    effectiveFrom: Date,
    note: string | undefined,
    actor: Actor,
  ): Promise<VersionRecord> {
    const version = await tx.insertVersion({
      ...config,
      microMarketId: market.id,
      version: (latest?.version ?? 0) + 1,
      effectiveFrom,
      note: note ?? null,
      createdBy: actor.userId,
    });
    await tx.appendEvent({
      type: 'config.micro_market_changed',
      aggregate: { type: 'micro_market', id: market.id },
      microMarketId: market.id,
      actor: { type: 'ops', id: actor.userId },
      payload: {
        micro_market_id: market.id,
        slug: market.slug,
        version: version.version,
        effective_from: effectiveFrom.toISOString(),
        changed: changedFields(latest, config),
      },
    });
    return version;
  }

  private checkEffectiveFrom(requested: Date | undefined): Date {
    const now = this.clock();
    if (!requested) return now;
    if (requested.getTime() < now.getTime() - BACKDATE_TOLERANCE_MS)
      throw new DomainError('VERSION_CONFLICT', 'A version cannot start in the past; past orders keep the config they were priced with');
    return requested;
  }

  private async checkPolygon(cityId: string, config: MicroMarketConfig, from: Date, excludeMarketId?: string): Promise<void> {
    const problems = polygonProblems(config.polygon);
    if (problems.length) throw new DomainError('POLYGON_INVALID', problems[0]!, { problems });
    const hits = await this.repo.overlapping(cityId, config.polygon, from, excludeMarketId);
    if (hits.length)
      throw new DomainError('POLYGON_OVERLAP', `The area overlaps ${[...new Set(hits.map((h) => h.slug))].join(', ')}`, {
        overlaps: hits,
      });
  }
}
