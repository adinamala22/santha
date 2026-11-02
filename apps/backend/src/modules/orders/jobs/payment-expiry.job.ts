import { Injectable, OnModuleInit } from '@nestjs/common';
import { Timers } from '../../../infra/timers/timers';
import { OrdersService } from '../orders.service';

export const PAYMENT_EXPIRY_JOB = 'orders.payment_expiry';
const EVERY_MS = 60_000;

/**
 * Every minute, online orders not paid within PAYMENT_WINDOW_MIN become PAYMENT_FAILED (promo budget
 * released). A repeatable job on the shared Timers service; POST /v1/dev/jobs/payment-expiry runs it
 * on demand in fake mode.
 */
@Injectable()
export class PaymentExpiryJob implements OnModuleInit {
  constructor(
    private readonly orders: OrdersService,
    private readonly timers: Timers,
  ) {}

  async onModuleInit(): Promise<void> {
    this.timers.register(PAYMENT_EXPIRY_JOB, () => this.orders.expireUnpaid());
    await this.timers.repeat(PAYMENT_EXPIRY_JOB, EVERY_MS);
  }
}
