import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import type { DomainEvent } from '../../infra/outbox/domain-event';
import { EventBus } from '../../infra/outbox/event-bus';
import { MockPaymentsProvider, PaymentsProvider } from '../../infra/providers/payments/payments.provider';
import { type PaymentIntentRecord, PaymentsRepository, type WalletEntryRecord } from './payments.repository';

/** What the app needs to open the payment sheet (Razorpay checkout, or the dev mock sheet). */
export interface CheckoutPayload {
  intentId: string;
  provider: 'razorpay' | 'mock';
  providerOrderId: string;
  keyId: string | null;
  amountPaise: number;
  currency: string;
  status: PaymentIntentRecord['status'];
  lastFailure: string | null;
}

const system = { type: 'system' as const, id: null };

/**
 * payments-settlement (M4 part): payment intents for online orders, checkout confirmation with
 * signature verification, Razorpay webhooks (verified, stored raw, deduped, processed
 * idempotently), and the wallet (refund credits only). Settlement runs and refunds come in M7.
 * Events out: payment.intent_created, payment.captured, payment.failed, wallet.credited.
 * Events in: order.payment_failed (closes the intent).
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly provider: PaymentsProvider,
    private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.bus.on('order.payment_failed', 'payments', (e) => this.onOrderPaymentFailed(e));
  }

  get providerName(): 'razorpay' | 'mock' {
    return this.provider.name;
  }

  async createIntent(order: { id: string; code: string; userId: string; microMarketId: string; totalPaise: number }): Promise<CheckoutPayload> {
    const po = await this.provider.createOrder({ amountPaise: order.totalPaise, receipt: order.code, notes: { order_id: order.id } });
    const intent = await this.repo.transaction(async (tx) => {
      const i = await tx.insertIntent({
        id: randomUUID(),
        orderId: order.id,
        userId: order.userId,
        microMarketId: order.microMarketId,
        amountPaise: po.amountPaise,
        currency: po.currency,
        provider: this.provider.name,
        providerOrderId: po.providerOrderId,
      });
      await tx.appendEvent({
        type: 'payment.intent_created',
        aggregate: { type: 'payment', id: i.id },
        microMarketId: order.microMarketId,
        actor: { type: 'user', id: order.userId },
        payload: { order_id: order.id, amount_paise: i.amountPaise, provider: i.provider },
      });
      return i;
    });
    return this.checkout(intent);
  }

  checkout(i: PaymentIntentRecord): CheckoutPayload {
    return {
      intentId: i.id,
      provider: i.provider as 'razorpay' | 'mock',
      providerOrderId: i.providerOrderId,
      keyId: this.provider.keyId,
      amountPaise: i.amountPaise,
      currency: i.currency,
      status: i.status,
      lastFailure: i.failureReason,
    };
  }

  intentForOrder(orderId: string): Promise<PaymentIntentRecord | null> {
    return this.repo.intentForOrder(orderId);
  }

  /**
   * Checkout success callback from the app (Razorpay handler: order id, payment id, signature).
   * Verifies the signature, then captures. Idempotent: confirming a captured intent is a no-op.
   */
  async confirm(userId: string, intentId: string, p: { providerOrderId: string; providerPaymentId: string; signature: string }): Promise<CheckoutPayload> {
    const intent = await this.repo.getIntent(intentId);
    if (!intent || intent.userId !== userId) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (p.providerOrderId !== intent.providerOrderId || !this.provider.verifyPaymentSignature(p))
      throw new DomainError('PAYMENT_SIGNATURE_INVALID', "We couldn't verify this payment. If money was taken, it will be refunded automatically.");
    await this.capture(intent, p.providerPaymentId, 'checkout');
    return this.checkout((await this.repo.getIntent(intentId))!);
  }

  /**
   * A verified provider webhook: stored raw first (deduped by provider event id), then processed.
   * Duplicate deliveries return quietly. Invalid signatures are rejected before anything is stored.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined): Promise<{ ok: true; duplicate: boolean }> {
    if (!rawBody || !this.provider.verifyWebhook(rawBody, signature)) throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'Webhook body is not JSON');
    }
    const w = this.provider.parseWebhook(body, eventIdHeader);
    const fresh = await this.repo.transaction((tx) =>
      tx.insertWebhook({ provider: this.provider.name, providerEventId: w.providerEventId, eventType: w.eventType, payload: body }),
    );
    if (!fresh) return { ok: true, duplicate: true };

    const intent = w.providerOrderId ? await this.repo.intentByProviderOrder(w.providerOrderId) : null;
    if (intent && w.kind === 'captured' && w.providerPaymentId) await this.capture(intent, w.providerPaymentId, 'webhook');
    if (intent && w.kind === 'failed') await this.noteFailure(intent, w.failureReason ?? 'Payment failed');
    if (!intent && w.kind !== 'ignored') this.logger.warn({ providerOrderId: w.providerOrderId, event: w.eventType }, 'Webhook for an unknown payment');
    await this.repo.transaction((tx) => tx.markWebhookProcessed(this.provider.name, w.providerEventId));
    return { ok: true, duplicate: false };
  }

  /** created → captured once, with payment.captured (orders then places the order). */
  private async capture(intent: PaymentIntentRecord, providerPaymentId: string, source: 'checkout' | 'webhook' | 'dev'): Promise<void> {
    await this.repo.transaction(async (tx) => {
      if (!(await tx.markCaptured(intent.id, providerPaymentId, this.clock()))) return; // already captured (or closed)
      await tx.appendEvent({
        type: 'payment.captured',
        aggregate: { type: 'payment', id: intent.id },
        microMarketId: intent.microMarketId,
        actor: system,
        payload: { order_id: intent.orderId, user_id: intent.userId, amount_paise: intent.amountPaise, provider_payment_id: providerPaymentId, source },
      });
    });
  }

  /** A failed attempt: the customer may retry in the same sheet, so the intent stays open. */
  private async noteFailure(intent: PaymentIntentRecord, reason: string): Promise<void> {
    await this.repo.transaction(async (tx) => {
      await tx.noteFailure(intent.id, reason);
      await tx.appendEvent({
        type: 'payment.failed',
        aggregate: { type: 'payment', id: intent.id },
        microMarketId: intent.microMarketId,
        actor: system,
        payload: { order_id: intent.orderId, reason },
      });
    });
  }

  private async onOrderPaymentFailed(e: DomainEvent): Promise<void> {
    const intent = await this.repo.intentForOrder(e.aggregate.id);
    if (!intent) return;
    const reason = (e.payload as { reason?: string }).reason ?? 'payment_not_completed';
    await this.repo.transaction((tx) => tx.markFailed(intent.id, reason));
  }

  // ───────────── dev / fake mode ─────────────

  /** PAYMENTS_PROVIDER=mock only: plays the payment sheet — success goes through the same signed confirm path. */
  async devSimulate(intentId: string, outcome: 'succeed' | 'fail'): Promise<CheckoutPayload> {
    if (!(this.provider instanceof MockPaymentsProvider)) throw new DomainError('NOT_FOUND', 'Not found');
    const intent = await this.repo.getIntent(intentId);
    if (!intent) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (outcome === 'fail') await this.noteFailure(intent, 'Payment declined by the bank (mock)');
    else {
      const paymentId = `pay_mock_${randomBytes(7).toString('hex')}`;
      await this.confirm(intent.userId, intent.id, { providerOrderId: intent.providerOrderId, providerPaymentId: paymentId, signature: this.provider.signPayment(intent.providerOrderId, paymentId) });
    }
    return this.checkout((await this.repo.getIntent(intentId))!);
  }

  // ───────────── wallet (refund credits only) ─────────────

  // ───────────── settlement support (M7) ─────────────

  /** Refund to the card / UPI the customer paid with; ok:false when the order was not paid online. */
  async refundToSource(orderId: string, amountPaise: number, receipt: string): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
    const intent = await this.repo.intentForOrder(orderId);
    if (!intent || intent.status !== 'captured' || !intent.providerPaymentId) return { ok: false, error: 'not_paid_online' };
    return this.provider.refund({ providerPaymentId: intent.providerPaymentId, amountPaise, receipt });
  }

  /** Route transfer to a store's or rider's linked account. */
  transfer(account: string, amountPaise: number, reference: string) {
    return this.provider.transfer({ account, amountPaise, reference });
  }

  capturedBetween(from: Date, to: Date) {
    return this.repo.capturedBetween(from, to);
  }

  /** The aggregator report for a day. The mock with no scripted report mirrors what was captured (2% fee). */
  async settlementReport(date: string, captured: PaymentIntentRecord[] = []) {
    if (this.provider instanceof MockPaymentsProvider && this.provider.report === null)
      return captured.map((c) => ({ providerPaymentId: c.providerPaymentId!, amountPaise: c.amountPaise, feePaise: Math.round(c.amountPaise * 0.02) }));
    return this.provider.settlementReport(date);
  }

  async wallet(userId: string): Promise<{ balancePaise: number; entries: WalletEntryRecord[] }> {
    const [balancePaise, entries] = await Promise.all([this.repo.walletBalance(userId), this.repo.walletEntries(userId, 50)]);
    return { balancePaise, entries };
  }

  /** Credits a refund to the wallet (wallet holds refund credits only — no top-ups in the MVP). */
  async creditWallet(input: { userId: string; amountPaise: number; orderId: string | null; note: string; microMarketId: string | null; actorId?: string | null }): Promise<WalletEntryRecord> {
    if (input.amountPaise <= 0) throw new DomainError('VALIDATION_FAILED', 'Credit must be positive');
    return this.repo.transaction(async (tx) => {
      const entry = await tx.addWalletEntry({
        userId: input.userId,
        amountPaise: input.amountPaise,
        kind: 'refund_credit',
        orderId: input.orderId,
        note: input.note,
        createdBy: input.actorId ?? null,
      });
      await tx.appendEvent({
        type: 'wallet.credited',
        aggregate: { type: 'wallet', id: input.userId },
        microMarketId: input.microMarketId,
        actor: input.actorId ? { type: 'ops', id: input.actorId } : system,
        payload: { user_id: input.userId, amount_paise: input.amountPaise, order_id: input.orderId, note: input.note },
      });
      return entry;
    });
  }
}
