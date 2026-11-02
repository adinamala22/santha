import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, RequestId, Roles } from '../../../common/auth/decorators';
import { DomainError } from '../../../common/errors/domain-error';
import { DispatchService } from '../../dispatch-tracking/dispatch.service';
import { MerchantsService } from '../../merchant-catalogue/merchants.service';
import { OrdersService } from '../../orders/orders.service';
import { istDate } from './domain/money';
import {
  DisputeDto,
  DisputeListDto,
  DisputeQueryDto,
  OpenDisputeDto,
  PayoutDto,
  PayoutListDto,
  ReconDto,
  ReconListDto,
  ReconRunDto,
  ReconRunResultDto,
  RefundDto,
  RefundListDto,
  RefundQueryDto,
  RejectRefundDto,
  ResolveDisputeDto,
  ResolveReconDto,
  RunDto,
  RunListDto,
  RunSettlementDto,
  toDisputeDto,
  toPayoutDto,
  toReconDto,
  toRefundDto,
  toRunDto,
} from './dto/money.dto';
import type { PayoutRecord, RefundRecord } from './money.repository';
import { RefundsService } from './refunds.service';
import { SettlementService } from './settlement.service';

const DISPUTE_H = 48;

/** Shared view helpers (names, codes) for the money controllers. */
abstract class MoneyViews {
  constructor(
    protected readonly settlement: SettlementService,
    protected readonly merchants: MerchantsService,
    protected readonly dispatch: DispatchService,
    protected readonly orders: OrdersService,
  ) {}

  protected async partyName(p: PayoutRecord) {
    if (p.partyType === 'merchant') return (await this.merchants.record(p.partyId).catch(() => null))?.name ?? '—';
    return (await this.dispatch.ridersAll()).find((r) => r.userId === p.partyId)?.name ?? '—';
  }

  protected async payout(p: PayoutRecord) {
    return toPayoutDto(p, await this.partyName(p));
  }

  protected async refund(r: RefundRecord, trust: number | null = null) {
    const [o, m] = await Promise.all([this.orders.get(r.orderId), this.merchants.record(r.merchantId).catch(() => null)]);
    const disputable = r.status === 'processed' && r.liability === 'merchant' && !!r.processedAt && this.settlement.now().getTime() - r.processedAt.getTime() <= DISPUTE_H * 3_600_000;
    return toRefundDto(r, { orderCode: o?.code ?? '', merchantName: m?.name ?? '—', trustScore: trust, disputable });
  }
}

/** Merchant app: payouts with statements, refunds charged to the store, disputes. */
@ApiTags('merchants')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('merchant')
@Controller('merchants/me')
export class MerchantMoneyController extends MoneyViews {
  constructor(settlement: SettlementService, merchants: MerchantsService, dispatch: DispatchService, orders: OrdersService) {
    super(settlement, merchants, dispatch, orders);
  }

  private async mine(u: AuthUser, payoutId: string) {
    const m = await this.merchants.ownedBy(u.userId);
    const p = await this.settlement.payout(payoutId);
    if (!p || p.partyType !== 'merchant' || p.partyId !== m.id) throw new DomainError('NOT_FOUND', 'Payout not found');
    return p;
  }

  @Get('payouts')
  @ZodResponse({ type: PayoutListDto, description: 'Daily payouts, newest first' })
  async payouts(@CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    return { items: await Promise.all((await this.settlement.payoutsForParty('merchant', m.id)).map((p) => this.payout(p))) };
  }

  @Get('payouts/:id')
  @ZodResponse({ type: PayoutDto })
  async payoutDetail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.payout(await this.mine(u, id));
  }

  @Get('payouts/:id/statement.pdf')
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  async statementPdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const p = await this.mine(u, id);
    return new StreamableFile(await this.settlement.statementPdf(p), { disposition: `attachment; filename="santha-statement-${istDate(p.periodStart)}.pdf"` });
  }

  @Get('payouts/:id/statement.csv')
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async statementCsv(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.settlement.csv(await this.mine(u, id));
  }

  @Get('refunds')
  @ZodResponse({ type: RefundListDto, description: 'Refunds charged to the store in the last 30 days (disputable for 48 h)' })
  async refunds(@CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    const rows = await this.settlement.merchantRefunds(m.id, new Date(this.settlement.now().getTime() - 30 * 86_400_000));
    return { items: await Promise.all(rows.map((r) => this.refund(r))) };
  }

  @Post('disputes')
  @ZodResponse({ status: 201, type: DisputeDto, description: '422 DISPUTE_WINDOW_CLOSED after 48 h; 409 ALREADY_EXISTS' })
  async openDispute(@Body() b: OpenDisputeDto, @CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    return toDisputeDto(await this.settlement.openDispute(m.id, { refundId: b.refundId, reason: b.reason, evidenceMediaIds: b.evidenceMediaIds }), m.name);
  }

  @Get('disputes')
  @ZodResponse({ type: DisputeListDto })
  async disputes(@CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    return { items: (await this.settlement.disputes({ merchantId: m.id, limit: 100 })).map((d) => toDisputeDto(d, m.name)) };
  }
}

/** Rider app: payouts (weekly by default). */
@ApiTags('riders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('rider')
@Controller('riders/me')
export class RiderMoneyController extends MoneyViews {
  constructor(settlement: SettlementService, merchants: MerchantsService, dispatch: DispatchService, orders: OrdersService) {
    super(settlement, merchants, dispatch, orders);
  }

  @Get('payouts')
  @ZodResponse({ type: PayoutListDto })
  async payouts(@CurrentUser() u: AuthUser) {
    return { items: await Promise.all((await this.settlement.payoutsForParty('rider', u.userId)).map((p) => this.payout(p))) };
  }
}

/** Ops / finance: settlement runs, payouts, refunds (four-eyes), reconciliation, disputes. All mutations audited. */
@ApiTags('ops')
@ApiBearerAuth()
@Roles('admin', 'ops', 'finance')
@Controller('ops')
export class OpsMoneyController extends MoneyViews {
  constructor(
    settlement: SettlementService,
    merchants: MerchantsService,
    dispatch: DispatchService,
    orders: OrdersService,
    private readonly refundsSvc: RefundsService,
  ) {
    super(settlement, merchants, dispatch, orders);
  }

  private actor = (u: AuthUser, requestId: string | null) => ({ userId: u.userId, roles: u.roles, requestId });

  @Get('settlements')
  @ZodResponse({ type: RunListDto })
  async runs() {
    return { items: (await this.settlement.runs()).map(toRunDto) };
  }

  @Post('settlements/run')
  @Roles('admin', 'finance')
  @ZodResponse({ status: 201, type: RunDto, description: 'Runs (or returns) the settlement for an IST date; idempotent per period' })
  async run(@Body() b: RunSettlementDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    const a = this.actor(u, requestId);
    const r = b.kind === 'merchant' ? await this.settlement.runMerchants(b.date, a) : await this.settlement.runRiders(b.kind === 'rider_daily' ? 'daily' : 'weekly', b.date, a);
    return toRunDto(r);
  }

  @Get('settlements/:id/payouts')
  @ZodResponse({ type: PayoutListDto })
  async runPayouts(@Param('id', ParseUUIDPipe) id: string) {
    return { items: await Promise.all((await this.settlement.payoutsForRun(id)).map((p) => this.payout(p))) };
  }

  @Get('settlements/:id/payouts.csv')
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async runCsv(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await Promise.all((await this.settlement.payoutsForRun(id)).map(async (p) => [p.partyType, await this.partyName(p), p.partyId, istDate(p.periodStart), p.grossPaise, p.tcsPaise, p.tdsPaise, p.netPaise, p.status, p.transferRef ?? '']));
    const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return [['party_type', 'name', 'party_id', 'period_start', 'gross_paise', 'tcs_paise', 'tds_paise', 'net_paise', 'status', 'transfer_ref'].join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
  }

  @Get('payouts/:id')
  @ZodResponse({ type: PayoutDto })
  async payoutDetail(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.settlement.payout(id);
    if (!p) throw new DomainError('NOT_FOUND', 'Payout not found');
    return this.payout(p);
  }

  @Get('payouts/:id/statement.pdf')
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  async payoutPdf(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.settlement.payout(id);
    if (!p) throw new DomainError('NOT_FOUND', 'Payout not found');
    return new StreamableFile(await this.settlement.statementPdf(p), { disposition: `attachment; filename="statement-${p.id.slice(0, 8)}.pdf"` });
  }

  @Post('payouts/:id/retry')
  @Roles('admin', 'finance')
  @HttpCode(200)
  @ZodResponse({ type: PayoutDto })
  async retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return this.payout(await this.settlement.retry(id, this.actor(u, requestId)));
  }

  @Get('refunds')
  @ZodResponse({ type: RefundListDto, description: 'open = pending or awaiting a second approval' })
  async refunds(@Query() q: RefundQueryDto) {
    const statuses = q.status === 'open' ? (['pending', 'awaiting_second'] as const) : q.status === 'all' ? undefined : ([q.status] as const);
    const rows = await this.refundsSvc.list({ statuses, limit: 200 });
    return { items: await Promise.all(rows.map((r) => this.refund(r))) };
  }

  @Post('refunds/:id/approve')
  @HttpCode(200)
  @ZodResponse({ type: RefundDto, description: '409 FOUR_EYES_REQUIRED (same person twice); 403 APPROVAL_LIMIT (ops above ₹2,000)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return this.refund(await this.refundsSvc.approve(id, this.actor(u, requestId)));
  }

  @Post('refunds/:id/reject')
  @HttpCode(200)
  @ZodResponse({ type: RefundDto })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: RejectRefundDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return this.refund(await this.refundsSvc.reject(id, this.actor(u, requestId), b.note));
  }

  @Get('recon')
  @ZodResponse({ type: ReconListDto })
  async recon(@Query('status') status?: string) {
    return { items: (await this.settlement.reconExceptions(status === 'resolved' ? 'resolved' : status === 'all' ? undefined : 'open')).map(toReconDto) };
  }

  @Post('recon/run')
  @Roles('admin', 'finance')
  @HttpCode(200)
  @ZodResponse({ type: ReconRunResultDto })
  reconRun(@Body() b: ReconRunDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return this.settlement.reconcileDay(b.date, this.actor(u, requestId));
  }

  @Post('recon/:id/resolve')
  @HttpCode(200)
  @ZodResponse({ type: ReconDto })
  async reconResolve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveReconDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return toReconDto(await this.settlement.resolveRecon(id, this.actor(u, requestId), b.note));
  }

  @Get('disputes')
  @ZodResponse({ type: DisputeListDto })
  async disputes(@Query() q: DisputeQueryDto) {
    const rows = await this.settlement.disputes({ statuses: q.status === 'all' ? undefined : [q.status], limit: 200 });
    return { items: await Promise.all(rows.map(async (d) => toDisputeDto(d, (await this.merchants.record(d.merchantId).catch(() => null))?.name ?? '—'))) };
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  @ZodResponse({ type: DisputeDto })
  async resolveDispute(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveDisputeDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    const d = await this.settlement.resolveDispute(id, b.decision, b.note, this.actor(u, requestId));
    return toDisputeDto(d, (await this.merchants.record(d.merchantId).catch(() => null))?.name ?? '—');
  }
}
