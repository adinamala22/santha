import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { createZodDto } from '../../../common/zod-dto';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public, RequestId, Roles } from '../../../common/auth/decorators';
import { GrowthService } from './growth.service';
import type { LeadRecord } from './leads.repository';

/** Shop types offered on the /stores form (ADR-023). */
export const LEAD_CATEGORIES = ['kirana', 'supermarket', 'fruits_vegetables', 'pharmacy', 'bakery', 'dairy', 'meat_fish', 'fashion', 'electronics', 'other'] as const;

const int = z.number().int();
const pctN = z.number().nullable();

class LeadInputDto extends createZodDto(
  z.object({
    kind: z.enum(['store', 'home_kitchen', 'rider', 'customer']).describe('customer = launch-list sign-up (ADR-023)'),
    name: z.string().trim().min(2).max(80),
    phone: z.string().regex(/^(\+?91)?[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
    business: z.string().trim().max(80).optional().describe('Shop or kitchen name'),
    category: z.enum(LEAD_CATEGORIES).optional().describe('Shop type picked on the form'),
    area: z.string().trim().max(80).optional(),
    message: z.string().trim().max(500).optional(),
    locale: z.enum(['en', 'te']).optional(),
    /** Honeypot: hidden on the form; anything here means a bot. */
    website: z.string().max(200).optional(),
  }),
) {}
class LeadAckDto extends createZodDto(z.object({ ok: z.literal(true) })) {}
const LeadSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['store', 'home_kitchen', 'rider', 'customer']),
  name: z.string(),
  phone: z.string(),
  business: z.string().nullable(),
  category: z.string().nullable(),
  area: z.string().nullable(),
  message: z.string().nullable(),
  locale: z.string(),
  status: z.enum(['new', 'contacted', 'converted', 'dropped']),
  note: z.string().nullable(),
  createdAt: z.string(),
});
class LeadListDto extends createZodDto(z.object({ items: z.array(LeadSchema) })) {}
class LeadDto extends createZodDto(LeadSchema) {}
class LeadPatchDto extends createZodDto(z.object({ status: z.enum(['new', 'contacted', 'converted', 'dropped']), note: z.string().trim().max(500).optional() })) {}

class ReportQueryDto extends createZodDto(
  z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive IST date; default: the last 7 days') }),
) {}
class ReportDto extends createZodDto(
  z.object({
    from: z.string(),
    to: z.string(),
    funnel: z.object({ placed: int, accepted: int, delivered: int, cancelled: int, rejected: int, expired: int }),
    onTimePercent: pctN,
    fillRatePercent: pctN,
    contribution: z.object({ totalPaise: int, perOrderPaise: int.nullable(), commissionPaise: int, feesPaise: int, riderCostPaise: int, storeCreditsPaise: int, platformRefundsPaise: int, discountsPaise: int }),
    merchants: z.array(z.object({ merchantId: z.uuid(), name: z.string(), orders: int, acceptancePercent: pctN, avgPrepMin: int.nullable(), issueRatePercent: pctN, rating: pctN })),
    riders: z.array(z.object({ riderUserId: z.uuid(), name: z.string(), deliveries: int, onTimePercent: pctN, earningsPaise: int })),
  }),
) {}

const toLead = (l: LeadRecord) => ({ ...l, createdAt: l.createdAt.toISOString() });

/** Website lead forms (/stores, /home-kitchens, /riders). */
@ApiTags('growth')
@Public()
@Controller('leads')
export class LeadsController {
  constructor(private readonly growth: GrowthService) {}

  @Post()
  @HttpCode(201)
  @ZodResponse({ status: 201, type: LeadAckDto, description: 'Honeypot + per-IP rate limit (5/hour); repeated leads within a day are merged' })
  create(@Body() b: LeadInputDto, @Req() req: Request) {
    return this.growth.createLead(b, req.ip ?? 'unknown');
  }
}

/** Ops: leads follow-up and business reports. */
@ApiTags('ops')
@ApiBearerAuth()
@Roles('admin', 'ops', 'finance')
@Controller('ops')
export class OpsGrowthController {
  constructor(private readonly growth: GrowthService) {}

  @Get('leads')
  @ZodResponse({ type: LeadListDto })
  async leads(@Query('status') status?: string) {
    const s = (['new', 'contacted', 'converted', 'dropped'] as const).find((x) => x === status);
    return { items: (await this.growth.listLeads(s)).map(toLead) };
  }

  @Patch('leads/:id')
  @ZodResponse({ type: LeadDto })
  async updateLead(@Param('id', ParseUUIDPipe) id: string, @Body() b: LeadPatchDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return toLead(await this.growth.updateLead(id, b.status, b.note, { userId: u.userId, requestId }));
  }

  @Get('reports')
  @ZodResponse({ type: ReportDto, description: 'Funnel, on-time, fill rate, contribution per order, merchant health, rider utilisation for an IST date range' })
  report(@Query() q: ReportQueryDto) {
    const now = this.growth.now();
    const istToday = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const to = new Date(new Date(`${q.to ?? istToday}T00:00:00+05:30`).getTime() + 86_400_000);
    const from = q.from ? new Date(`${q.from}T00:00:00+05:30`) : new Date(to.getTime() - 7 * 86_400_000);
    return this.growth.report(from, to);
  }
}
