import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { createZodDto } from '../../common/zod-dto';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public, RequestId, Roles } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import type { DataRequestRecord, GrievanceRecord } from './compliance.repository';
import { ComplianceService, NOTICE_VERSIONS } from './compliance.service';
import type { RatingRecord } from './issues.repository';
import { IssuesService } from './issues.service';

const iso = z.string();
const GRIEVANCE_CATEGORIES = ['order', 'payment', 'refund', 'account', 'privacy', 'other'] as const;
const PURPOSES = Object.keys(NOTICE_VERSIONS) as [keyof typeof NOTICE_VERSIONS, ...Array<keyof typeof NOTICE_VERSIONS>];

class GrievanceInputDto extends createZodDto(
  z.object({ category: z.enum(GRIEVANCE_CATEGORIES), description: z.string().trim().min(10).max(2000), orderId: z.uuid().optional() }),
) {}
const GrievanceSchema = z.object({
  id: z.uuid(),
  app: z.enum(['consumer', 'merchant', 'rider']),
  orderId: z.uuid().nullable(),
  category: z.enum(GRIEVANCE_CATEGORIES),
  description: z.string(),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  resolution: z.string().nullable(),
  ackDueAt: iso,
  resolveDueAt: iso,
  acknowledgedAt: iso.nullable(),
  resolvedAt: iso.nullable(),
  createdAt: iso,
  /** Ops view: overdue against the legal clock. */
  overdue: z.boolean(),
});
class GrievanceDto extends createZodDto(GrievanceSchema) {}
class GrievanceListDto extends createZodDto(z.object({ items: z.array(GrievanceSchema) })) {}
class ResolveGrievanceDto extends createZodDto(z.object({ resolution: z.string().trim().min(5).max(2000) })) {}

class ConsentInputDto extends createZodDto(z.object({ purpose: z.enum(PURPOSES), granted: z.boolean() })) {}
class ConsentListDto extends createZodDto(
  z.object({ items: z.array(z.object({ purpose: z.enum(PURPOSES), granted: z.boolean(), version: z.string(), current: z.boolean(), at: iso.nullable() })) }),
) {}

class DataRequestInputDto extends createZodDto(z.object({ type: z.enum(['access', 'correction', 'erasure']), details: z.string().trim().max(1000).optional() })) {}
const DataRequestSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  type: z.enum(['access', 'correction', 'erasure']),
  details: z.string().nullable(),
  status: z.enum(['open', 'completed', 'rejected']),
  note: z.string().nullable(),
  exportReady: z.boolean(),
  createdAt: iso,
  completedAt: iso.nullable(),
});
class DataRequestDto extends createZodDto(DataRequestSchema) {}
class DataRequestListDto extends createZodDto(z.object({ items: z.array(DataRequestSchema) })) {}
class DecideDataRequestDto extends createZodDto(z.object({ decision: z.enum(['complete', 'reject']), note: z.string().trim().min(3).max(1000) })) {}

const ReviewSchema = z.object({
  orderId: z.uuid(),
  merchantId: z.uuid(),
  storeStars: z.number().int(),
  comment: z.string().nullable(),
  status: z.enum(['visible', 'flagged', 'hidden']),
  flagReason: z.string().nullable(),
  reply: z.string().nullable(),
  createdAt: iso,
});
class ReviewListDto extends createZodDto(z.object({ items: z.array(ReviewSchema) })) {}
class ReviewDto extends createZodDto(ReviewSchema) {}

/** Average and count of store stars (hidden reviews excluded), and the counts for 1…5 stars. */
const RatingSummarySchema = z.object({
  avg: z.number().nullable(),
  count: z.number().int(),
  distribution: z.array(z.number().int()).length(5).describe('Counts for 1, 2, 3, 4 and 5 stars'),
});
class MerchantReviewListDto extends createZodDto(z.object({ summary: RatingSummarySchema, items: z.array(ReviewSchema) })) {}
const PublicReviewSchema = z.object({ storeStars: z.number().int(), comment: z.string().nullable(), reply: z.string().nullable(), replyAt: iso.nullable(), createdAt: iso });
class StoreReviewsDto extends createZodDto(z.object({ summary: RatingSummarySchema, items: z.array(PublicReviewSchema) })) {}
const toPublicReview = (r: RatingRecord) => ({ storeStars: r.storeStars, comment: r.comment, reply: r.reply, replyAt: r.replyAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() });
class ReplyDto extends createZodDto(z.object({ text: z.string().trim().min(2).max(500) })) {}
class ModerateDto extends createZodDto(z.object({ decision: z.enum(['publish', 'hide']) })) {}

class PublicStoreDto extends createZodDto(
  z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    nameTe: z.string().nullable(),
    type: z.string(),
    description: z.string().nullable(),
    area: z.string().nullable(),
    areaTe: z.string().nullable(),
    location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
    rating: RatingSummarySchema,
    reviews: z.array(z.object({ storeStars: z.number().int(), comment: z.string().nullable(), reply: z.string().nullable(), createdAt: iso })),
  }),
) {}

class PublicStoreListDto extends createZodDto(z.object({ items: z.array(z.object({ slug: z.string(), name: z.string(), updatedAt: iso })) })) {}

const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;
const toGrievance = (g: GrievanceRecord, now: Date) => ({
  id: g.id,
  app: g.app,
  orderId: g.orderId,
  category: g.category as (typeof GRIEVANCE_CATEGORIES)[number],
  description: g.description,
  status: g.status,
  resolution: g.resolution,
  ackDueAt: g.ackDueAt.toISOString(),
  resolveDueAt: g.resolveDueAt.toISOString(),
  acknowledgedAt: isoOrNull(g.acknowledgedAt),
  resolvedAt: isoOrNull(g.resolvedAt),
  createdAt: g.createdAt.toISOString(),
  overdue: (g.status === 'open' && now > g.ackDueAt) || (g.status !== 'resolved' && now > g.resolveDueAt),
});
const toRequest = (r: DataRequestRecord) => ({ ...r, exportReady: !!r.exportKey, createdAt: r.createdAt.toISOString(), completedAt: isoOrNull(r.completedAt) });
const toReview = (r: RatingRecord) => ({ orderId: r.orderId, merchantId: r.merchantId, storeStars: r.storeStars, comment: r.comment, status: r.status, flagReason: r.flagReason, reply: r.reply, createdAt: r.createdAt.toISOString() });

/** Any signed-in person: grievances, consents, data-principal requests. */
@ApiTags('me')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('me')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Post('grievances')
  @ZodResponse({ status: 201, type: GrievanceDto, description: 'Acknowledged within 48 h, resolved within a month (E-Commerce Rules 2020)' })
  async grievance(@Body() b: GrievanceInputDto, @CurrentUser() u: AuthUser) {
    const app = (['consumer', 'merchant', 'rider'] as const).find((a) => a === u.app) ?? 'consumer';
    return toGrievance(await this.compliance.raiseGrievance(u.userId, app, b), this.compliance.now());
  }

  @Get('grievances')
  @ZodResponse({ type: GrievanceListDto })
  async grievances(@CurrentUser() u: AuthUser) {
    const now = this.compliance.now();
    return { items: (await this.compliance.myGrievances(u.userId)).map((g) => toGrievance(g, now)) };
  }

  @Get('consents')
  @ZodResponse({ type: ConsentListDto, description: 'Latest choice per purpose and whether it was given for the current notice version' })
  async consents(@CurrentUser() u: AuthUser) {
    return { items: (await this.compliance.consents(u.userId)).map((c) => ({ ...c, at: isoOrNull(c.at) })) };
  }

  @Put('consents')
  @ZodResponse({ type: ConsentListDto })
  async setConsent(@Body() b: ConsentInputDto, @CurrentUser() u: AuthUser) {
    await this.compliance.setConsent(u.userId, b.purpose, b.granted, 'app');
    return { items: (await this.compliance.consents(u.userId)).map((c) => ({ ...c, at: isoOrNull(c.at) })) };
  }

  @Post('data-requests')
  @ZodResponse({ status: 201, type: DataRequestDto, description: 'access → export ready at once; correction / erasure → handled by the privacy team' })
  async request(@Body() b: DataRequestInputDto, @CurrentUser() u: AuthUser) {
    return toRequest(await this.compliance.request(u.userId, b.type, b.details));
  }

  @Get('data-requests')
  @ZodResponse({ type: DataRequestListDto })
  async requests(@CurrentUser() u: AuthUser) {
    return { items: (await this.compliance.myRequests(u.userId)).map(toRequest) };
  }

  @Get('data-requests/:id/export')
  @ApiProduces('application/json')
  @Header('Content-Type', 'application/json')
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return new StreamableFile(await this.compliance.exportFile(u.userId, id), { disposition: 'attachment; filename="santha-my-data.json"' });
  }
}

/** Store: reviews of its orders and public replies. */
@ApiTags('merchants')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('merchant')
@Controller('merchants/me/reviews')
export class MerchantReviewsController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly merchants: MerchantsService,
    private readonly issues: IssuesService,
  ) {}

  @Get()
  @ZodResponse({ type: MerchantReviewListDto, description: 'Rating summary and published reviews, newest first' })
  async list(@CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    const [summary, items] = await Promise.all([this.issues.storeSummary(m.id), this.compliance.reviewsForMerchant(m.id)]);
    return { summary, items: items.map(toReview) };
  }

  @Post(':orderId/reply')
  @HttpCode(200)
  @ZodResponse({ type: ReviewDto })
  async reply(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() b: ReplyDto, @CurrentUser() u: AuthUser) {
    return toReview(await this.compliance.reply(u.userId, orderId, b.text));
  }
}

/** Ops: grievance officer desk, privacy requests, review moderation. Every decision audited. */
@ApiTags('ops')
@ApiBearerAuth()
@Roles('admin', 'ops')
@Controller('ops')
export class OpsComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  private actor = (u: AuthUser, requestId: string | null) => ({ userId: u.userId, requestId });

  @Get('grievances')
  @ZodResponse({ type: GrievanceListDto })
  async grievances(@Query('status') status?: string) {
    const now = this.compliance.now();
    const statuses = status === 'open' ? (['open', 'acknowledged'] as const) : status === 'resolved' ? (['resolved'] as const) : undefined;
    return { items: (await this.compliance.grievances(statuses)).map((g) => toGrievance(g, now)) };
  }

  @Post('grievances/:id/acknowledge')
  @HttpCode(200)
  @ZodResponse({ type: GrievanceDto })
  async ack(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return toGrievance(await this.compliance.acknowledge(id, this.actor(u, requestId)), this.compliance.now());
  }

  @Post('grievances/:id/resolve')
  @HttpCode(200)
  @ZodResponse({ type: GrievanceDto })
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveGrievanceDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return toGrievance(await this.compliance.resolveGrievance(id, b.resolution, this.actor(u, requestId)), this.compliance.now());
  }

  @Get('data-requests')
  @ZodResponse({ type: DataRequestListDto })
  async requests(@Query('status') status?: string) {
    return { items: (await this.compliance.requests(status === 'open' ? ['open'] : undefined)).map(toRequest) };
  }

  @Post('data-requests/:id/decide')
  @HttpCode(200)
  @ZodResponse({ type: DataRequestDto, description: 'Erasure anonymises the account (refused while an order is open)' })
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecideDataRequestDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return toRequest(await this.compliance.decide(id, b.decision, b.note, this.actor(u, requestId)));
  }

  @Get('reviews')
  @ZodResponse({ type: ReviewListDto, description: 'Reviews held by the screen' })
  async reviews() {
    return { items: (await this.compliance.flaggedReviews()).map(toReview) };
  }

  @Post('reviews/:orderId/moderate')
  @HttpCode(200)
  @ZodResponse({ type: ReviewDto })
  async moderate(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() b: ModerateDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return toReview(await this.compliance.moderate(orderId, b.decision, this.actor(u, requestId)));
  }
}

/** Public store link page data (/s/{slug} on the web, M8): profile, rating, published reviews. */
@ApiTags('discovery')
@Public()
@Controller('public/stores')
export class PublicStoreController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly markets: MicroMarketsService,
    private readonly issues: IssuesService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get()
  @ZodResponse({ type: PublicStoreListDto, description: 'Live store links for the sitemap' })
  async list() {
    return { items: (await this.merchants.live()).filter((m) => m.slug).map((m) => ({ slug: m.slug!, name: m.name, updatedAt: m.updatedAt.toISOString() })) };
  }

  @Get(':slug')
  @ZodResponse({ type: PublicStoreDto })
  async store(@Param('slug') slug: string) {
    const m = (await this.merchants.live()).find((x) => x.slug === slug);
    if (!m) throw new DomainError('NOT_FOUND', 'Store not found');
    const market = m.microMarketId ? await this.markets.get(m.microMarketId).catch(() => null) : null;
    const reviews = (await this.compliance.reviewsForMerchant(m.id)).filter((r) => r.comment).slice(0, 6);
    return {
      id: m.id,
      slug,
      name: m.name,
      nameTe: m.nameTe,
      type: m.type,
      description: m.description,
      area: market?.market.name ?? null,
      areaTe: market?.market.nameTe ?? null,
      location: m.location,
      rating: await this.issues.storeSummary(m.id),
      reviews: reviews.map((r) => ({ storeStars: r.storeStars, comment: r.comment, reply: r.reply, createdAt: r.createdAt.toISOString() })),
    };
  }
}

/** Consumer store page (PRD 4.4: rating distribution, verified-purchase reviews with the store's replies). */
@ApiTags('discovery')
@Public()
@Controller('stores')
export class StoreReviewsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly issues: IssuesService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get(':id/reviews')
  @ZodResponse({ type: StoreReviewsDto, description: 'Rating summary (1–5 star breakdown) and the newest published reviews that have a comment' })
  async reviews(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) {
    const m = await this.merchants.record(id).catch(() => null);
    if (!m || m.status !== 'live') throw new DomainError('NOT_FOUND', 'Store not found');
    const n = Math.min(Math.max(Number.parseInt(limit ?? '', 10) || 20, 1), 50);
    const [summary, published] = await Promise.all([this.issues.storeSummary(id), this.compliance.reviewsForMerchant(id)]);
    return { summary, items: published.filter((r) => r.comment).slice(0, n).map(toPublicReview) };
  }
}
