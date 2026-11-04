import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { createZodDto } from '../../common/zod-dto';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../../common/auth/decorators';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import type { IssueRecord, RatingRecord } from './issues.repository';
import { IssuesService } from './issues.service';

const int = z.number().int();
const iso = z.string();
const ISSUE_TYPES = ['missing_item', 'wrong_item', 'damaged', 'quality', 'late', 'not_delivered', 'return_request'] as const;

class ReportIssueDto extends createZodDto(
  z.object({
    type: z.enum(ISSUE_TYPES),
    variantIds: z.array(z.uuid()).max(50).optional().describe('Lines with the problem (item issues and returns)'),
    description: z.string().trim().max(1000).optional(),
    photoMediaIds: z.array(z.uuid()).max(5).optional(),
  }),
) {}
class RateDto extends createZodDto(
  z.object({ storeStars: int.min(1).max(5), riderStars: int.min(1).max(5).optional(), comment: z.string().trim().max(500).optional() }),
) {}

const IssueSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  type: z.enum(ISSUE_TYPES),
  variantIds: z.array(z.uuid()),
  description: z.string().nullable(),
  claimedPaise: int,
  /** auto_resolved | pending_review | approved | rejected | return_pickup */
  status: z.enum(['auto_resolved', 'pending_review', 'approved', 'rejected', 'return_pickup']),
  refundPaise: int,
  refundDestination: z.enum(['wallet', 'source']).nullable(),
  reason: z.string(),
  createdAt: iso,
  decidedAt: iso.nullable(),
});
class IssueDto extends createZodDto(IssueSchema) {}
class IssueListDto extends createZodDto(z.object({ items: z.array(IssueSchema) })) {}
class OpsIssueListDto extends createZodDto(
  z.object({ items: z.array(IssueSchema.extend({ userId: z.uuid(), merchantName: z.string(), trustScore: z.number(), flags: z.array(z.string()) })) }),
) {}
const RatingSchema = z.object({ orderId: z.uuid(), storeStars: int, riderStars: int.nullable(), comment: z.string().nullable(), createdAt: iso });
class RatingDto extends createZodDto(RatingSchema) {}
class MyRatingDto extends createZodDto(z.object({ rating: RatingSchema.nullable() })) {}

const toIssueDto = (i: IssueRecord) => {
  const d = i.decision as { amountPaise?: number; destination?: 'wallet' | 'source'; reason?: string };
  return {
    id: i.id,
    orderId: i.orderId,
    type: i.type as (typeof ISSUE_TYPES)[number],
    variantIds: i.variantIds,
    description: i.description,
    claimedPaise: i.claimedPaise,
    status: i.status,
    refundPaise: i.status === 'rejected' ? 0 : (d.amountPaise ?? 0),
    refundDestination: i.status === 'rejected' ? null : (d.destination ?? null),
    reason: d.reason ?? '',
    createdAt: i.createdAt.toISOString(),
    decidedAt: i.decidedAt?.toISOString() ?? null,
  };
};
const toRatingDto = (r: RatingRecord) => ({ orderId: r.orderId, storeStars: r.storeStars, riderStars: r.riderStars, comment: r.comment, createdAt: r.createdAt.toISOString() });

/** Customer: report a problem with a delivered order, rate it. */
@ApiTags('orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('orders')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Post(':id/issues')
  @ZodResponse({ status: 201, type: IssueDto, description: 'Decided at once: auto_resolved (refunded to the wallet), pending_review, return_pickup or rejected. 422 ISSUE_WINDOW_CLOSED; 409 ALREADY_EXISTS' })
  async report(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReportIssueDto, @CurrentUser() u: AuthUser) {
    return toIssueDto(await this.issues.report(u.userId, id, b));
  }

  @Get(':id/issues')
  @ZodResponse({ type: IssueListDto })
  async list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return { items: (await this.issues.issuesForOrder(u.userId, id)).map(toIssueDto) };
  }

  @Post(':id/rating')
  @ZodResponse({ status: 201, type: RatingDto, description: 'Once per delivered order; 409 ALREADY_EXISTS' })
  async rate(@Param('id', ParseUUIDPipe) id: string, @Body() b: RateDto, @CurrentUser() u: AuthUser) {
    return toRatingDto(await this.issues.rate(u.userId, id, b));
  }

  @Get(':id/rating')
  @ZodResponse({ type: MyRatingDto, description: 'Your rating of this order; rating is null until you rate it' })
  async myRating(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const r = await this.issues.ratingFor(u.userId, id);
    return { rating: r ? toRatingDto(r) : null };
  }
}

/** Ops: issues with the customer's trust score and flags. */
@ApiTags('ops')
@ApiBearerAuth()
@Roles('admin', 'ops', 'finance')
@Controller('ops/issues')
export class OpsIssuesController {
  constructor(
    private readonly issues: IssuesService,
    private readonly merchants: MerchantsService,
  ) {}

  @Get()
  @ZodResponse({ type: OpsIssueListDto })
  async list(@Query('status') status?: string) {
    const rows = await this.issues.list({ statuses: status === 'open' ? ['pending_review', 'return_pickup'] : undefined, limit: 200 });
    const trust = new Map<string, { score: number; flags: string[] }>();
    const out = [];
    for (const i of rows) {
      if (!trust.has(i.userId)) trust.set(i.userId, await this.issues.trust(i.userId));
      const t = trust.get(i.userId)!;
      out.push({ ...toIssueDto(i), userId: i.userId, merchantName: (await this.merchants.record(i.merchantId).catch(() => null))?.name ?? '—', trustScore: t.score, flags: t.flags });
    }
    return { items: out };
  }
}
