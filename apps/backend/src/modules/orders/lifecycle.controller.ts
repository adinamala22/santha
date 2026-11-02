import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Roles } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments-settlement/payments.service';
import { OrderDto, toOrderDto } from './dto/orders.dto';
import {
  AcceptDto,
  BucketQueryDto,
  CancelOrderDto,
  ItemUnavailableDto,
  MerchantOrderDto,
  MerchantOrderListDto,
  OpsOrderDetailDto,
  OpsOrderListDto,
  OpsOrdersQueryDto,
  RejectDto,
  toMerchantListDto,
  toMerchantOrderDto,
  toOpsOrderDetailDto,
  toOpsOrderDto,
} from './dto/lifecycle.dto';
import { OrderLifecycleService } from './lifecycle.service';
import { OrderRepository, type OrderState } from './orders.repository';
import { OrdersService } from './orders.service';

/** Merchant app: the store's orders and every action on them (M5). */
@ApiTags('merchant-orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('merchant')
@Controller()
export class MerchantOrdersController {
  constructor(private readonly lifecycle: OrderLifecycleService) {}

  @Get('merchants/me/orders')
  @ZodResponse({ type: MerchantOrderListDto, description: 'Orders in one tab (new · preparing · ready · out · done), tab counts and today’s summary' })
  async list(@Query() q: BucketQueryDto, @CurrentUser() u: AuthUser) {
    return toMerchantListDto(await this.lifecycle.list(u.userId, q.bucket));
  }

  @Get('merchants/me/orders/:id')
  @ZodResponse({ type: MerchantOrderDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return toMerchantOrderDto(await this.lifecycle.get(u.userId, id));
  }

  @Post('orders/:id/accept')
  @HttpCode(200)
  @ZodResponse({ type: MerchantOrderDto, description: 'PLACED → ACCEPTED → PREPARING; reveals the address' })
  async accept(@Param('id', ParseUUIDPipe) id: string, @Body() b: AcceptDto, @CurrentUser() u: AuthUser) {
    return toMerchantOrderDto(await this.lifecycle.accept(u.userId, id, b));
  }

  @Post('orders/:id/reject')
  @HttpCode(200)
  @ZodResponse({ type: MerchantOrderDto, description: 'PLACED → REJECTED; the customer is refunded' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: RejectDto, @CurrentUser() u: AuthUser) {
    return toMerchantOrderDto(await this.lifecycle.reject(u.userId, id, b.reason));
  }

  @Post('orders/:id/items/:variantId/unavailable')
  @HttpCode(200)
  @ZodResponse({ type: MerchantOrderDto, description: 'Remove the item or substitute one at the same or lower price; the difference is refunded at once' })
  async unavailable(@Param('id', ParseUUIDPipe) id: string, @Param('variantId', ParseUUIDPipe) variantId: string, @Body() b: ItemUnavailableDto, @CurrentUser() u: AuthUser) {
    return toMerchantOrderDto(await this.lifecycle.itemUnavailable(u.userId, id, variantId, b as never));
  }

  @Post('orders/:id/ready')
  @HttpCode(200)
  @ZodResponse({ type: MerchantOrderDto, description: 'PREPARING → READY' })
  async ready(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return toMerchantOrderDto(await this.lifecycle.markReady(u.userId, id));
  }
}

/** Consumer: cancel before the store accepts. */
@ApiTags('orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('orders')
export class CustomerOrderActionsController {
  constructor(
    private readonly lifecycle: OrderLifecycleService,
    private readonly orders: OrdersService,
  ) {}

  @Post(':id/cancel')
  @HttpCode(200)
  @ZodResponse({ type: OrderDto, description: 'Free cancellation while the order is PLACED (refunded to the wallet); 409 once the store accepted' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() b: CancelOrderDto, @CurrentUser() u: AuthUser) {
    await this.lifecycle.customerCancel(u.userId, id, b.reason);
    return toOrderDto(await this.orders.view(u.userId, id));
  }
}

/** Ops console: live orders and one order's timeline + comms log (FR-OPS). */
@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('admin', 'ops', 'support', 'finance')
@Controller('ops/orders')
export class OpsOrdersController {
  constructor(
    private readonly repo: OrderRepository,
    private readonly merchants: MerchantsService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ZodResponse({ type: OpsOrderListDto })
  async list(@Query() q: OpsOrdersQueryDto) {
    const states = q.state ? (q.state.split(',').map((s) => s.trim().toUpperCase()) as OrderState[]) : undefined;
    const orders = await this.repo.listRecent({ states, microMarketId: q.microMarketId, limit: q.limit });
    const names = new Map<string, string>();
    for (const id of new Set(orders.map((o) => o.merchantId))) names.set(id, (await this.merchants.record(id).catch(() => null))?.name ?? '—');
    return { items: orders.map((o) => toOpsOrderDto(o, names.get(o.merchantId)!)) };
  }

  @Get(':id')
  @ZodResponse({ type: OpsOrderDetailDto })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const o = await this.repo.get(id);
    if (!o) throw new DomainError('NOT_FOUND', 'Order not found');
    const [m, history, payment, comms] = await Promise.all([
      this.merchants.record(o.merchantId).catch(() => null),
      this.repo.history(o.id),
      this.payments.intentForOrder(o.id),
      this.notifications.forOrder(o.id),
    ]);
    return toOpsOrderDetailDto(o, m?.name ?? '—', history, payment, comms);
  }
}
