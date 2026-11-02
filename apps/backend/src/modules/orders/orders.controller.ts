import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Public } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CheckoutDto, CheckoutInputDto, OrderDto, OrderListDto, PlaceOrderDto, toCheckoutDto, toOrderDto } from './dto/orders.dto';
import { OrdersService } from './orders.service';

/** Checkout and the consumer's orders. */
@ApiTags('orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('cart/price')
  @HttpCode(200)
  @ZodResponse({ type: CheckoutDto, description: 'Bill for the cart delivered to an address at a time (ASAP or a kitchen slot), with every problem that would block placing it. Saves a quote valid for QUOTE_TTL_MIN.' })
  async price(@Body() b: CheckoutInputDto, @CurrentUser() u: AuthUser) {
    return toCheckoutDto(await this.orders.checkout(u.userId, b as never));
  }

  @Post('orders')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per checkout attempt; retries replay the first response for 24 h' })
  @ZodResponse({ status: 201, type: OrderDto, description: 'COD → PLACED. Online → AWAITING_PAYMENT with `payment` for the payment sheet. 409 QUOTE_CHANGED / QUOTE_EXPIRED: re-check the bill. 422 NOT_PLACEABLE / COD_NOT_ALLOWED / PROMO_INVALID.' })
  async place(@Body() b: PlaceOrderDto, @CurrentUser() u: AuthUser, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const { view, replayed } = await this.orders.place(u.userId, key, b);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return toOrderDto(view);
  }

  @Get('orders')
  @ZodResponse({ type: OrderListDto })
  async list(@CurrentUser() u: AuthUser) {
    return { items: (await this.orders.list(u.userId)).map(toOrderDto) };
  }

  @Get('orders/:id')
  @ZodResponse({ type: OrderDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return toOrderDto(await this.orders.view(u.userId, id));
  }

  @Post('orders/:id/abandon-payment')
  @HttpCode(200)
  @ZodResponse({ type: OrderDto, description: 'The customer gave up paying: AWAITING_PAYMENT → PAYMENT_FAILED (promo budget released).' })
  async abandon(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return toOrderDto(await this.orders.abandonPayment(u.userId, id));
  }
}

/** Dev helpers for time-based jobs (fake mode or mock payments only; 404 otherwise). */
@ApiExcludeController()
@Public()
@Controller('dev/jobs')
export class DevOrderJobsController {
  constructor(
    private readonly orders: OrdersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('payment-expiry')
  @HttpCode(200)
  async expire() {
    if (this.env.APP_ENV === 'production' || (this.env.DATA_STORE !== 'memory' && this.env.PAYMENTS_PROVIDER !== 'mock')) throw new DomainError('NOT_FOUND', 'Not found');
    return this.orders.expireUnpaid();
  }
}
