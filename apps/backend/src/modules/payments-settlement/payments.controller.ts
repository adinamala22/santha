import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Public } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ConfirmPaymentDto, PaymentDto, WalletDto } from '../orders/dto/orders.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('payments/:id/confirm')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ type: PaymentDto, description: 'Payment sheet success callback (signature verified). The order becomes PLACED once the capture is processed.' })
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body() b: ConfirmPaymentDto, @CurrentUser() u: AuthUser, @Headers('idempotency-key') key: string | undefined) {
    const { value } = await this.idempotency.run('payments.confirm', u.userId, key, { id, ...b }, () => this.payments.confirm(u.userId, id, b));
    return value;
  }

  @Post('tips/:id/confirm')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ type: PaymentDto, description: 'Tip payment sheet success callback (signature verified); same shape as an order payment (ADR-037)' })
  async confirmTip(@Param('id', ParseUUIDPipe) id: string, @Body() b: ConfirmPaymentDto, @CurrentUser() u: AuthUser, @Headers('idempotency-key') key: string | undefined) {
    const { value } = await this.idempotency.run('tips.confirm', u.userId, key, { id, ...b }, () => this.payments.confirmTip(u.userId, id, b));
    return value;
  }

  @Get('wallet')
  @ZodResponse({ type: WalletDto, description: 'Refund credits (the wallet holds refund credits only)' })
  async wallet(@CurrentUser() u: AuthUser) {
    const w = await this.payments.wallet(u.userId);
    return {
      balancePaise: w.balancePaise,
      entries: w.entries.map((e) => ({ id: e.id, amountPaise: e.amountPaise, kind: e.kind, orderId: e.orderId, note: e.note, createdAt: e.createdAt.toISOString() })),
    };
  }
}

/** Provider webhooks: signature verified on the raw body, stored, processed idempotently; 200 fast. */
@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('razorpay')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async razorpay(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature: string | undefined, @Headers('x-razorpay-event-id') eventId: string | undefined) {
    return this.payments.handleWebhook(req.rawBody, signature, eventId);
  }
}

/** Mock payment sheet for dev builds and fake mode (PAYMENTS_PROVIDER=mock, never in production). */
@ApiExcludeController()
@Public()
@Controller('dev/payments')
export class DevPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post(':id/:outcome')
  @HttpCode(200)
  async simulate(@Param('id', ParseUUIDPipe) id: string, @Param('outcome') outcome: string) {
    if (this.env.APP_ENV === 'production' || (outcome !== 'succeed' && outcome !== 'fail')) throw new DomainError('NOT_FOUND', 'Not found');
    return this.payments.devSimulate(id, outcome);
  }
}

/** Mock payment sheet for a tip (fake mode and dev builds only; never in production). */
@ApiExcludeController()
@Public()
@Controller('dev/tips')
export class DevTipsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post(':id/:outcome')
  @HttpCode(200)
  async simulate(@Param('id', ParseUUIDPipe) id: string, @Param('outcome') outcome: string) {
    if (this.env.APP_ENV === 'production' || (outcome !== 'succeed' && outcome !== 'fail')) throw new DomainError('NOT_FOUND', 'Not found');
    return this.payments.devSimulateTip(id, outcome);
  }
}
