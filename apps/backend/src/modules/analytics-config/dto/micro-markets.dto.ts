import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { WeeklyHoursSchema } from '../../../common/hours';
import {
  CodRulesSchema,
  FeeRulesSchema,
  MicroMarketConfigSchema,
  PolygonSchema,
  RiderPaySchema,
  SlaSchema,
} from '../domain/micro-market-config';
import type { CityRecord, MicroMarketRecord, VersionRecord } from '../micro-markets.repository';

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words separated by hyphens').min(3).max(48);

export const CreateMicroMarketSchema = z.object({
  citySlug: slug,
  slug,
  name: z.string().trim().min(2).max(80),
  nameTe: z.string().trim().min(1).max(80).describe('Telugu name'),
  config: MicroMarketConfigSchema,
  effectiveFrom: z.iso.datetime({ offset: true }).optional().describe('ISO-8601. Default: now. Cannot be in the past.'),
  note: z.string().trim().max(500).optional(),
});
export class CreateMicroMarketDto extends createZodDto(CreateMicroMarketSchema) {}

export const PublishVersionSchema = z.object({
  config: MicroMarketConfigSchema,
  effectiveFrom: z.iso.datetime({ offset: true }).optional().describe('ISO-8601. Default: now. Must be after the latest version start.'),
  note: z.string().trim().max(500).optional(),
});
export class PublishVersionDto extends createZodDto(PublishVersionSchema) {}

const iso = z.iso.datetime();

export const VersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  effectiveFrom: iso,
  effectiveTo: iso.nullable(),
  polygon: PolygonSchema,
  hours: WeeklyHoursSchema,
  fees: FeeRulesSchema,
  cod: CodRulesSchema,
  sla: SlaSchema,
  riderPay: RiderPaySchema,
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: iso,
});

const MarketSchema = z.object({
  id: z.uuid(),
  cityId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  nameTe: z.string(),
});

const CitySchema = z.object({ id: z.uuid(), slug: z.string(), name: z.string(), nameTe: z.string(), state: z.string() });

export const MicroMarketSummarySchema = MarketSchema.extend({
  currentVersion: z.number().int().nullable(),
  versionCount: z.number().int(),
  current: VersionSchema.nullable(),
});
export class MicroMarketListDto extends createZodDto(
  z.object({ cities: z.array(CitySchema), items: z.array(MicroMarketSummarySchema) }),
) {}

export const MicroMarketDetailSchema = MarketSchema.extend({
  current: VersionSchema.nullable(),
  versions: z.array(VersionSchema),
});
export class MicroMarketDetailDto extends createZodDto(MicroMarketDetailSchema) {}
export class VersionDto extends createZodDto(VersionSchema) {}

export const ServiceabilityQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export class ServiceabilityQueryDto extends createZodDto(ServiceabilityQuerySchema) {}

export class ServiceabilityDto extends createZodDto(
  z.object({
    serviceable: z.boolean(),
    microMarket: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), nameTe: z.string() }).nullable(),
    waitlist: z.boolean().describe('Show the "join waitlist" CTA when not serviceable'),
  }),
) {}

export const FlagsQuerySchema = z.object({ microMarketId: z.uuid().optional() });
export class FlagsQueryDto extends createZodDto(FlagsQuerySchema) {}
export class FlagsDto extends createZodDto(z.object({ flags: z.record(z.string(), z.boolean()) })) {}

// ── mappers ──

export const toVersionDto = (v: VersionRecord) => ({
  id: v.id,
  version: v.version,
  effectiveFrom: v.effectiveFrom.toISOString(),
  effectiveTo: v.effectiveTo?.toISOString() ?? null,
  polygon: v.polygon,
  hours: v.hours,
  fees: v.fees,
  cod: v.cod,
  sla: v.sla,
  riderPay: v.riderPay,
  note: v.note,
  createdBy: v.createdBy,
  createdAt: v.createdAt.toISOString(),
});

export const toMarketDto = (m: MicroMarketRecord) => ({ id: m.id, cityId: m.cityId, slug: m.slug, name: m.name, nameTe: m.nameTe });
export const toCityDto = (c: CityRecord) => ({ id: c.id, slug: c.slug, name: c.name, nameTe: c.nameTe, state: c.state });
