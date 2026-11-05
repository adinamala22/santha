import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { type AuthUser, CurrentUser, Public, RequestId, Roles } from '../../common/auth/decorators';
import {
  CityCoverageDto,
  CityDto,
  CreateMicroMarketDto,
  FlagsDto,
  FlagsQueryDto,
  MicroMarketDetailDto,
  MicroMarketListDto,
  PublishVersionDto,
  ServiceabilityDto,
  ServiceabilityQueryDto,
  toCityDto,
  toMarketDto,
  toVersionDto,
  VersionDto,
} from './dto/micro-markets.dto';
import { FlagsService } from './flags.service';
import { MicroMarketsService } from './micro-markets.service';

const toDate = (iso: string | undefined) => (iso ? new Date(iso) : undefined);

/** What the public website needs to know (ADR-023). */
class SiteConfigDto extends createZodDto(
  z.object({
    appDownloads: z.boolean().describe('Show the Android / iPhone download buttons (flag app_downloads); false = "Launching soon"'),
    androidUrl: z.string().nullable().describe('Play Store listing, when downloads are on'),
    iosUrl: z.string().nullable().describe('App Store listing, when downloads are on'),
  }),
) {}

/** Ops: city-wide coverage (ADR-019). */
@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('ops/cities')
export class OpsCitiesController {
  constructor(private readonly markets: MicroMarketsService) {}

  @Put(':id/coverage')
  @Roles('admin', 'ops')
  @ZodResponse({ type: CityDto, description: 'Audited; serviceability uses it at once' })
  async coverage(@Param('id', ParseUUIDPipe) id: string, @Body() body: CityCoverageDto, @CurrentUser() user: AuthUser, @RequestId() requestId: string | null) {
    return toCityDto(await this.markets.setCoverage(id, body, { userId: user.userId, requestId }));
  }
}

@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('ops/micro-markets')
export class OpsMicroMarketsController {
  constructor(private readonly markets: MicroMarketsService) {}

  @Get()
  @Roles('admin', 'ops', 'finance', 'support')
  @ZodResponse({ type: MicroMarketListDto })
  async list() {
    const [cities, items] = await Promise.all([this.markets.listCities(), this.markets.list()]);
    return {
      cities: cities.map(toCityDto),
      items: items.map((i) => ({
        ...toMarketDto(i.market),
        currentVersion: i.current?.version ?? null,
        versionCount: i.versionCount,
        current: i.current ? toVersionDto(i.current) : null,
      })),
    };
  }

  @Get(':id')
  @Roles('admin', 'ops', 'finance', 'support')
  @ZodResponse({ type: MicroMarketDetailDto })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const d = await this.markets.get(id);
    return {
      ...toMarketDto(d.market),
      current: d.current ? toVersionDto(d.current) : null,
      versions: d.versions.map(toVersionDto),
    };
  }

  @Post()
  @Roles('admin', 'ops')
  @ZodResponse({ status: 201, type: MicroMarketDetailDto, description: 'Created with version 1' })
  async create(@Body() body: CreateMicroMarketDto, @CurrentUser() user: AuthUser, @RequestId() requestId: string | null) {
    const { market } = await this.markets.create({ ...body, effectiveFrom: toDate(body.effectiveFrom) }, { userId: user.userId, requestId });
    return this.get(market.id);
  }

  @Post(':id/versions')
  @HttpCode(201)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 201, type: VersionDto, description: 'New version published' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PublishVersionDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId: string | null,
  ) {
    return toVersionDto(
      await this.markets.publishVersion(id, { ...body, effectiveFrom: toDate(body.effectiveFrom) }, { userId: user.userId, requestId }),
    );
  }
}

@ApiTags('config')
@Controller()
export class ConfigController {
  constructor(
    private readonly markets: MicroMarketsService,
    private readonly flags: FlagsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Public website settings (ADR-023): download buttons only once ops turn on app_downloads (PostHog, no
   * redeploy); until then the site says "Launching soon on Android and iPhone". Cached by the site for a minute.
   */
  @Public()
  @Get('config/site')
  @ZodResponse({ type: SiteConfigDto })
  async site() {
    const on = await this.flags.isEnabled('app_downloads', { distinctId: 'website' });
    return { appDownloads: on, androidUrl: on ? (this.env.ANDROID_APP_URL ?? null) : null, iosUrl: on ? (this.env.IOS_APP_URL ?? null) : null };
  }

  /** Is this point inside a live micro-market right now? Public: the consumer app asks before login. */
  @Public()
  @Get('serviceability')
  @ZodResponse({ type: ServiceabilityDto })
  async serviceability(@Query() q: ServiceabilityQueryDto) {
    const { hit, nearest } = await this.markets.explain(q);
    const flags = await this.flags.evaluate({ distinctId: 'anonymous', microMarketId: hit?.market.id });
    return {
      serviceable: !!hit,
      microMarket: hit ? { id: hit.market.id, slug: hit.market.slug, name: hit.market.name, nameTe: hit.market.nameTe } : null,
      waitlist: !hit && flags.serviceability_waitlist,
      matchedBy: hit?.matchedBy ?? null,
      reason: hit ? null : ('outside_service_area' as const),
      nearest: !hit && nearest ? { name: nearest.market.name, nameTe: nearest.market.nameTe, distanceM: nearest.distanceM } : null,
    };
  }

  @Get('config/flags')
  @ApiBearerAuth()
  @ApiHeader({ name: 'X-Device-Id', required: true })
  @ZodResponse({ type: FlagsDto })
  async flagsFor(@Query() q: FlagsQueryDto, @CurrentUser() user: AuthUser) {
    return { flags: await this.flags.evaluate({ distinctId: user.userId, microMarketId: q.microMarketId }) };
  }
}
