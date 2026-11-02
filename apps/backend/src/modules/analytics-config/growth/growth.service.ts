import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../../common/clock';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import type { DomainEvent } from '../../../infra/outbox/domain-event';
import { EventBus } from '../../../infra/outbox/event-bus';
import { DispatchService } from '../../dispatch-tracking/dispatch.service';
import { RateLimiter } from '../../identity-kyc/rate-limiter';
import { MerchantsService } from '../../merchant-catalogue/merchants.service';
import { OrdersService } from '../../orders/orders.service';
import { RefundsService } from '../../payments-settlement/settlement/refunds.service';
import { IssuesService } from '../../trust-safety/issues.service';
import { DEFAULT_CONFIG } from '../domain/micro-market-config';
import { buildReport, type ReportDelivery, type ReportOrder } from './domain/reports';
import { type LeadRecord, LeadsRepository } from './leads.repository';

/** Domain events exported to analytics (PostHog now; ClickHouse via PostHog export later). */
export const EXPORTED_EVENTS = [
  'user.registered',
  'merchant.went_live',
  'merchant.auto_paused',
  'order.placed',
  'order.accepted',
  'order.rejected',
  'order.expired',
  'order.ready',
  'order.picked_up',
  'order.delivered',
  'order.cancelled',
  'payment.captured',
  'payment.failed',
  'wallet.credited',
] as const;

export interface Captured {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

/**
 * growth (M8): website leads (stores, home kitchens, riders), business reports for /admin/reports, and
 * the server-side analytics export: selected domain events go to PostHog with the micro-market as a
 * property (mock buffer in dev/test, never personal data — ids only).
 */
@Injectable()
export class GrowthService implements OnModuleInit {
  private readonly logger = new Logger(GrowthService.name);
  /** Dev/test sink when PostHog is not configured. */
  readonly captured: Captured[] = [];

  constructor(
    private readonly leads: LeadsRepository,
    private readonly limiter: RateLimiter,
    private readonly orders: OrdersService,
    private readonly dispatch: DispatchService,
    private readonly merchants: MerchantsService,
    private readonly refunds: RefundsService,
    private readonly issues: IssuesService,
    private readonly bus: EventBus,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    for (const type of EXPORTED_EVENTS) this.bus.on(type, 'analytics-export', (e) => this.export(e));
  }

  private async export(e: DomainEvent): Promise<void> {
    const p = e.payload as Record<string, unknown>;
    // Ids and amounts only; phone numbers and addresses never leave (DPDP, PRD 9).
    const properties: Record<string, unknown> = { micro_market_id: e.micro_market_id, aggregate_id: e.aggregate.id, actor_type: e.actor.type };
    for (const k of ['merchant_id', 'state', 'from', 'to', 'reason', 'total_paise', 'item_count', 'payment_method', 'amount_paise', 'type', 'fulfilment_mode'])
      if (p[k] !== undefined) properties[k] = p[k];
    const c: Captured = { event: e.type, distinctId: e.actor.id ?? e.aggregate.id, properties, timestamp: e.occurred_at };
    if (!this.env.POSTHOG_KEY || this.env.DATA_STORE === 'memory') {
      this.captured.push(c);
      if (this.captured.length > 5_000) this.captured.splice(0, 1_000);
      return;
    }
    const host = (this.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com').replace(/\/$/, '');
    const res = await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: this.env.POSTHOG_KEY, event: c.event, distinct_id: c.distinctId, properties: c.properties, timestamp: c.timestamp }),
      signal: AbortSignal.timeout(5_000),
    }).catch((err: Error) => {
      this.logger.warn({ err: err.message, event: c.event }, 'PostHog capture failed');
      return null;
    });
    if (res && !res.ok) this.logger.warn({ status: res.status, event: c.event }, 'PostHog capture rejected');
  }

  // ───────────── leads ─────────────

  async createLead(input: { kind: LeadRecord['kind']; name: string; phone: string; area?: string | undefined; message?: string | undefined; locale?: string | undefined; website?: string | undefined }, ip: string): Promise<{ ok: true }> {
    // Honeypot: bots fill the hidden "website" field; answer as if accepted.
    if (input.website) return { ok: true };
    const rl = await this.limiter.hit(`lead:ip:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`, 5, 3600);
    if (!rl.allowed) throw new DomainError('RATE_LIMITED', 'Too many requests. Please try again later.', { retryAfterSec: rl.retryAfterSec });
    const phone = `+91${input.phone.replace(/\D/g, '').slice(-10)}`;
    if (await this.leads.recent(phone, input.kind, new Date(this.clock().getTime() - 86_400_000))) return { ok: true };
    await this.leads.create({ id: randomUUID(), kind: input.kind, name: input.name, phone, area: input.area ?? null, message: input.message ?? null, locale: input.locale === 'te' ? 'te' : 'en' });
    return { ok: true };
  }

  listLeads(status?: LeadRecord['status']) {
    return this.leads.list({ status, limit: 500 });
  }

  async updateLead(id: string, status: LeadRecord['status'], note: string | undefined) {
    const l = await this.leads.update(id, { status, ...(note !== undefined ? { note } : {}) });
    if (!l) throw new DomainError('NOT_FOUND', 'Lead not found');
    return l;
  }

  // ───────────── reports ─────────────

  async report(from: Date, to: Date) {
    const recent = (await this.orders.listRecent({ limit: 10_000 })).filter((o) => o.createdAt >= from && o.createdAt < to);
    const orders: ReportOrder[] = recent.map((o) => {
      const fees = ((o.quote as { bill?: { fees?: Array<{ amountPaise: number }> } } | null)?.bill?.fees ?? []).reduce((s, f) => s + f.amountPaise, 0);
      return {
        id: o.id,
        merchantId: o.merchantId,
        state: o.state,
        placed: o.state !== 'AWAITING_PAYMENT' && o.state !== 'PAYMENT_FAILED',
        accepted: !!o.acceptedAt,
        itemsPaise: o.itemsPaise,
        feesPaise: fees,
        discountPaise: o.discountPaise,
        prepMin: o.acceptedAt && o.readyAt ? Math.round((o.readyAt.getTime() - o.acceptedAt.getTime()) / 60_000) : null,
      };
    });
    const ids = new Set(orders.map((o) => o.id));
    const deliveries: ReportDelivery[] = [];
    const merchantIds = new Set(orders.map((o) => o.merchantId));
    for (const mid of merchantIds) {
      for (const f of await this.dispatch.deliveredForMerchant(mid, from)) {
        if (!ids.has(f.orderId) || !f.deliveredAt || f.deliveredAt >= to) continue;
        deliveries.push({
          orderId: f.orderId,
          merchantId: mid,
          riderUserId: f.mode === 'rider' ? f.riderUserId : null,
          mode: f.mode,
          onTime: f.deliveredAt <= f.promisedAt,
          riderPayPaise: f.riderPayPaise,
          storeCreditPaise: f.mode === 'self' ? f.selfBonusPaise + (((recent.find((o) => o.id === f.orderId)?.quote as { bill?: { fees?: Array<{ code: string; amountPaise: number }> } } | null)?.bill?.fees ?? []).find((x) => x.code === 'delivery')?.amountPaise ?? 0) : 0,
        });
      }
    }
    const refunds = (await this.refunds.list({ statuses: ['processed'], since: from, limit: 10_000 })).filter((r) => r.liability !== 'merchant' && r.processedAt && r.processedAt < to);
    const issues = (await this.issues.list({ since: from, limit: 10_000 })).filter((i) => i.createdAt < to);
    const issuesByMerchant = new Map<string, number>();
    for (const i of issues) issuesByMerchant.set(i.merchantId, (issuesByMerchant.get(i.merchantId) ?? 0) + 1);
    const ratingByMerchant = new Map<string, number | null>();
    for (const mid of merchantIds) ratingByMerchant.set(mid, (await this.issues.merchantRating(mid)).avg);
    const fees = DEFAULT_CONFIG.fees;
    const r = buildReport({
      orders,
      deliveries,
      platformRefundsPaise: refunds.reduce((s, x) => s + x.amountPaise, 0),
      issuesByMerchant,
      ratingByMerchant,
      rates: { commissionSelfPercent: fees.commissionSelfPercent ?? 6, commissionRiderPercent: fees.commissionRiderPercent ?? 9 },
    });
    const names = new Map<string, string>();
    for (const mid of merchantIds) names.set(mid, (await this.merchants.record(mid).catch(() => null))?.name ?? '—');
    const riders = new Map((await this.dispatch.ridersAll()).map((x) => [x.userId, x.name]));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      ...r,
      merchants: r.merchants.map((m) => ({ ...m, name: names.get(m.merchantId) ?? '—' })),
      riders: r.riders.map((x) => ({ ...x, name: riders.get(x.riderUserId) ?? '—' })),
    };
  }

  now() {
    return this.clock();
  }
}
