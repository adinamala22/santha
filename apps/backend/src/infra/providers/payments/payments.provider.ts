import { Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../../common/errors/domain-error';

export interface ProviderOrder {
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
}

/** What a verified webhook means for us, provider-neutral. */
export interface WebhookOutcome {
  providerEventId: string;
  eventType: string;
  kind: 'captured' | 'failed' | 'ignored';
  providerOrderId: string | null;
  providerPaymentId: string | null;
  failureReason: string | null;
}

export const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Payment gateway port (Razorpay; Cashfree as alternate). Implementations: Razorpay (live keys or
 * test-mode keys = sandbox) and a mock for dev/test/fake mode that never leaves the process.
 * Both use Razorpay's signature scheme so client and tests behave the same.
 */
export abstract class PaymentsProvider {
  abstract readonly name: 'razorpay' | 'mock';
  /** Public key the app passes to the checkout SDK (null for the mock). */
  abstract readonly keyId: string | null;
  protected abstract readonly keySecret: string;
  protected abstract readonly webhookSecret: string;

  abstract createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<ProviderOrder>;

  /** Refund (part of) a captured payment to the customer's source (M7). */
  abstract refund(input: { providerPaymentId: string; amountPaise: number; receipt: string }): Promise<{ ok: true; ref: string } | { ok: false; error: string }>;

  /** Razorpay Route transfer to a linked account (store or rider payout, M7). */
  abstract transfer(input: { account: string; amountPaise: number; reference: string }): Promise<{ ok: true; ref: string } | { ok: false; error: string }>;

  /** The aggregator's settlement report for an IST day (reconciliation, M7). */
  abstract settlementReport(date: string): Promise<Array<{ providerPaymentId: string; amountPaise: number; feePaise: number }>>;

  /** Checkout success callback: HMAC-SHA256(order_id|payment_id, key secret). */
  verifyPaymentSignature(p: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean {
    return safeEqualHex(hmacHex(this.keySecret, `${p.providerOrderId}|${p.providerPaymentId}`), p.signature);
  }

  /** Webhooks: HMAC-SHA256(raw body, webhook secret) in X-Razorpay-Signature. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    return !!signature && safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature);
  }

  /** Maps a Razorpay webhook body to an outcome. Unknown events are ignored (but stored). */
  parseWebhook(body: unknown, eventIdHeader: string | undefined): WebhookOutcome {
    const b = body as {
      event?: string;
      created_at?: number;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; error_description?: string } }; order?: { entity?: { id?: string } } };
    };
    const event = b.event ?? 'unknown';
    const payment = b.payload?.payment?.entity;
    const orderId = payment?.order_id ?? b.payload?.order?.entity?.id ?? null;
    const kind = event === 'payment.captured' || event === 'order.paid' ? 'captured' : event === 'payment.failed' ? 'failed' : 'ignored';
    return {
      providerEventId: eventIdHeader || `${event}:${payment?.id ?? orderId ?? 'none'}:${b.created_at ?? ''}`,
      eventType: event,
      kind,
      providerOrderId: orderId,
      providerPaymentId: payment?.id ?? null,
      failureReason: kind === 'failed' ? (payment?.error_description ?? 'Payment failed') : null,
    };
  }
}

export class RazorpayProvider extends PaymentsProvider {
  readonly name = 'razorpay' as const;
  private readonly logger = new Logger('Razorpay');

  constructor(
    readonly keyId: string,
    protected readonly keySecret: string,
    protected readonly webhookSecret: string,
  ) {
    super();
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<ProviderOrder> {
    try {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}` },
        body: JSON.stringify({ amount: input.amountPaise, currency: 'INR', receipt: input.receipt, notes: input.notes, payment_capture: 1 }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as { id?: string; amount?: number };
      if (!res.ok || !data.id) throw new Error(`status ${res.status}`);
      return { providerOrderId: data.id, amountPaise: data.amount ?? input.amountPaise, currency: 'INR' };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Razorpay order creation failed');
      throw new DomainError('PROVIDER_UNAVAILABLE', 'Online payment is not available right now. Try again or choose cash on delivery.');
    }
  }

  private async call<T>(path: string, init: { method: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: T }> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
  }

  async refund(input: { providerPaymentId: string; amountPaise: number; receipt: string }) {
    try {
      const r = await this.call<{ id?: string; error?: { description?: string } }>(`/payments/${input.providerPaymentId}/refund`, { method: 'POST', body: { amount: input.amountPaise, receipt: input.receipt, speed: 'normal' } });
      return r.ok && r.data.id ? { ok: true as const, ref: r.data.id } : { ok: false as const, error: r.data.error?.description ?? `status ${r.status}` };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }

  async transfer(input: { account: string; amountPaise: number; reference: string }) {
    try {
      const r = await this.call<{ id?: string; error?: { description?: string } }>('/transfers', { method: 'POST', body: { account: input.account, amount: input.amountPaise, currency: 'INR', notes: { reference: input.reference } } });
      return r.ok && r.data.id ? { ok: true as const, ref: r.data.id } : { ok: false as const, error: r.data.error?.description ?? `status ${r.status}` };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }

  async settlementReport(date: string) {
    const [y, m, d] = date.split('-').map(Number);
    const r = await this.call<{ items?: Array<{ type?: string; entity_id?: string; amount?: number; fee?: number }> }>(`/settlements/recon/combined?year=${y}&month=${m}&day=${d}`, { method: 'GET' });
    return (r.data.items ?? []).filter((i) => i.type === 'payment' && i.entity_id).map((i) => ({ providerPaymentId: i.entity_id!, amountPaise: i.amount ?? 0, feePaise: i.fee ?? 0 }));
  }
}

/** Fixed secrets so tests and the dev "pay" endpoint can sign like Razorpay does. Never used in production. */

export const MOCK_KEY_SECRET = 'mock_razorpay_key_secret';
export const MOCK_WEBHOOK_SECRET = 'mock_razorpay_webhook_secret';

export class MockPaymentsProvider extends PaymentsProvider {
  readonly name = 'mock' as const;
  readonly keyId = null;
  protected readonly keySecret = MOCK_KEY_SECRET;
  protected readonly webhookSecret = MOCK_WEBHOOK_SECRET;
  /** Test hook: make the next createOrder fail like an outage. */
  failNext = false;

  async createOrder(input: { amountPaise: number }): Promise<ProviderOrder> {
    if (this.failNext) {
      this.failNext = false;
      throw new DomainError('PROVIDER_UNAVAILABLE', 'Online payment is not available right now. Try again or choose cash on delivery.');
    }
    return { providerOrderId: `order_mock_${randomBytes(7).toString('hex')}`, amountPaise: input.amountPaise, currency: 'INR' };
  }

  readonly refunds: Array<{ providerPaymentId: string; amountPaise: number }> = [];
  readonly transfers: Array<{ account: string; amountPaise: number; reference: string }> = [];
  /** Test hook: what the aggregator report says (null = mirror captured payments exactly). */
  report: Array<{ providerPaymentId: string; amountPaise: number; feePaise: number }> | null = null;
  /** Test hook: fail the next transfer. */
  failNextTransfer = false;

  async refund(input: { providerPaymentId: string; amountPaise: number }) {
    this.refunds.push({ providerPaymentId: input.providerPaymentId, amountPaise: input.amountPaise });
    return { ok: true as const, ref: `rfnd_mock_${randomBytes(6).toString('hex')}` };
  }

  async transfer(input: { account: string; amountPaise: number; reference: string }) {
    if (this.failNextTransfer) {
      this.failNextTransfer = false;
      return { ok: false as const, error: 'Linked account not activated (mock)' };
    }
    this.transfers.push(input);
    return { ok: true as const, ref: `trf_mock_${randomBytes(6).toString('hex')}` };
  }

  async settlementReport() {
    return this.report ?? [];
  }

  /** What Razorpay's checkout would return for a successful payment (dev/test only). */
  signPayment(providerOrderId: string, providerPaymentId: string): string {
    return hmacHex(MOCK_KEY_SECRET, `${providerOrderId}|${providerPaymentId}`);
  }
}
