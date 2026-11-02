import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DomainEvent } from '../../infra/outbox/domain-event';
import { EventBus } from '../../infra/outbox/event-bus';
import { MessagingProvider } from '../../infra/providers/messaging/messaging.provider';
import { PushProvider } from '../../infra/providers/push/push.provider';
import { AuthService } from '../identity-kyc/auth.service';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { type Channel, NotificationRepository, type NotificationRecord } from './notifications.repository';
import { RealtimeGateway } from './realtime.gateway';
import { type Locale, render, rupees, type TemplateKey } from './templates';

interface OrderPayload {
  user_id: string;
  merchant_id: string;
  code: string;
  payment_method: 'online' | 'cod';
  total_paise: number;
  item_count?: number;
  to?: string;
  reason?: string;
  name?: string;
  substitute_name?: string | null;
  refund_paise?: number;
}

/** Order events that change what the customer sees (sent on every channel the customer allows). */
const CUSTOMER_TEMPLATES: Record<string, TemplateKey> = {
  'order.placed': 'customer.order_placed',
  'order.accepted': 'customer.order_accepted',
  'order.ready': 'customer.order_ready',
  'order.rejected': 'customer.order_rejected',
  'order.expired': 'customer.order_expired',
  'order.cancelled': 'customer.order_cancelled',
  'order.item_removed': 'customer.item_removed',
  'order.item_substituted': 'customer.item_substituted',
};

/** Events that only refresh screens (socket). */
const SOCKET_ONLY = ['order.preparing', 'order.payment_failed', 'order.picked_up', 'order.out_for_delivery', 'order.delivered', 'delivery.failed'];

/**
 * notifications — templates (en/te) per event and channel: socket (instant, app open), push (FCM;
 * merchant new-order alerts are urgent/ringing), SMS when a user has no push token (and as the
 * merchant's 30-s reminder), WhatsApp order updates for customers who opted in, and an automated voice
 * call when a merchant still hasn't answered at 60 s. Every send is written to the comms log.
 * Events in: order.*, merchant.auto_paused.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly push: PushProvider,
    private readonly messaging: MessagingProvider,
    private readonly realtime: RealtimeGateway,
    private readonly auth: AuthService,
    private readonly merchants: MerchantsService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    for (const type of [...Object.keys(CUSTOMER_TEMPLATES), ...SOCKET_ONLY]) this.bus.on(type, 'notifications', (e) => this.onOrderEvent(e));
    this.bus.on('merchant.auto_paused', 'notifications', (e) => this.onAutoPaused(e));
  }

  // ───────────── API for other modules / controllers ─────────────

  registerToken(userId: string, deviceId: string, token: string, platform: string): Promise<void> {
    return this.repo.upsertToken({ userId, deviceId, token, platform });
  }

  whatsappOptIn(userId: string): Promise<boolean> {
    return this.repo.whatsappOptIn(userId);
  }

  setWhatsappOptIn(userId: string, value: boolean): Promise<void> {
    return this.repo.setWhatsappOptIn(userId, value);
  }

  forOrder(orderId: string): Promise<NotificationRecord[]> {
    return this.repo.forOrder(orderId);
  }

  /** Merchant reminder when a new order is still waiting (orders schedules these: SMS at 30 s, call at 60 s). */
  async remindMerchant(merchantId: string, orderId: string, code: string, channel: 'sms' | 'voice'): Promise<void> {
    const m = await this.merchants.record(merchantId);
    const owner = await this.auth.me(m.ownerUserId);
    const locale = asLocale(owner.locale);
    const { title, body } = render('merchant.order_waiting', locale, { code });
    await this.sendMessage(channel, owner.phone, `${title}. ${body}`, 'merchant.order_waiting', locale, { userId: owner.id, merchantId, orderId });
  }

  // ───────────── event handlers ─────────────

  private async onOrderEvent(e: DomainEvent): Promise<void> {
    const p = e.payload as unknown as OrderPayload;
    const orderId = e.aggregate.id;
    const state = p.to ?? stateFor(e.type);
    // Screens first: socket is instant and free.
    const update = { orderId, code: p.code, type: e.type, state };
    this.realtime.emit(`user:${p.user_id}`, 'order.updated', update);
    this.realtime.emit(`merchant:${p.merchant_id}`, e.type === 'order.placed' ? 'order.new' : 'order.updated', update);

    if (e.type === 'order.placed') await this.alertMerchant(e, p);
    const template = CUSTOMER_TEMPLATES[e.type];
    // A customer who cancelled themselves doesn't need to be told.
    if (!template || (e.type === 'order.cancelled' && e.actor.type === 'user')) return;
    await this.notifyCustomer(template, p, orderId);
  }

  private async alertMerchant(e: DomainEvent, p: OrderPayload): Promise<void> {
    const m = await this.merchants.record(p.merchant_id);
    const owner = await this.auth.me(m.ownerUserId);
    const locale = asLocale(owner.locale);
    const msg = render('merchant.new_order', locale, { code: p.code, items: p.item_count ?? 0, total: rupees(p.total_paise), seconds: 20 });
    const ctx = { userId: owner.id, merchantId: m.id, orderId: e.aggregate.id };
    const pushed = await this.pushTo(owner.id, msg, { kind: 'new_order', orderId: e.aggregate.id, code: p.code }, true, 'merchant.new_order', locale, ctx);
    if (!pushed) await this.sendMessage('sms', owner.phone, `${msg.title}. ${msg.body}`, 'merchant.new_order', locale, ctx);
  }

  private async notifyCustomer(template: TemplateKey, p: OrderPayload, orderId: string): Promise<void> {
    const [user, m] = await Promise.all([this.auth.me(p.user_id), this.merchants.record(p.merchant_id)]);
    const locale = asLocale(user.locale);
    const store = locale === 'te' && m.nameTe ? m.nameTe : m.name;
    const refund = this.refundSentence(template, p, locale);
    const msg = render(template, locale, { store, code: p.code, name: p.name ?? '', substitute: p.substitute_name ?? '', refund });
    const ctx = { userId: user.id, merchantId: m.id, orderId };
    const pushed = await this.pushTo(user.id, msg, { kind: 'order', orderId, code: p.code }, false, template, locale, ctx);
    if (!pushed) await this.sendMessage('sms', user.phone, `${msg.title}. ${msg.body}`, template, locale, ctx);
    if (await this.repo.whatsappOptIn(user.id)) await this.sendMessage('whatsapp', user.phone, `${msg.title}. ${msg.body}`, template, locale, ctx);
  }

  private refundSentence(template: TemplateKey, p: OrderPayload, locale: Locale): string {
    const full = ['customer.order_rejected', 'customer.order_expired', 'customer.order_cancelled'].includes(template);
    const partial = template === 'customer.item_removed' || template === 'customer.item_substituted';
    if (!full && !partial) return '';
    const amount = full ? p.total_paise : (p.refund_paise ?? 0);
    if (amount <= 0) return '';
    if (p.payment_method === 'online') return render('fragment.refund_wallet', locale, { amount: rupees(amount) }).body;
    return full ? render('fragment.no_charge', locale, {}).body : render('fragment.refund_cod', locale, { amount: rupees(amount) }).body;
  }

  private async onAutoPaused(e: DomainEvent): Promise<void> {
    const m = await this.merchants.record(e.aggregate.id);
    const owner = await this.auth.me(m.ownerUserId);
    const locale = asLocale(owner.locale);
    const msg = render('merchant.auto_paused', locale, {});
    const ctx = { userId: owner.id, merchantId: m.id, orderId: null };
    this.realtime.emit(`merchant:${m.id}`, 'store.paused', { merchantId: m.id, reason: 'missed_orders' });
    await this.pushTo(owner.id, msg, { kind: 'store_paused' }, false, 'merchant.auto_paused', locale, ctx);
    await this.sendMessage('sms', owner.phone, `${msg.title}. ${msg.body}`, 'merchant.auto_paused', locale, ctx);
  }

  // ───────────── channels ─────────────

  /** Push to every device of the user; true if at least one accepted it. Dead tokens are dropped. */
  private async pushTo(
    userId: string,
    msg: { title: string; body: string },
    data: Record<string, string>,
    urgent: boolean,
    template: string,
    locale: Locale,
    ctx: { userId: string; merchantId: string | null; orderId: string | null },
  ): Promise<boolean> {
    const tokens = await this.repo.tokensFor(userId);
    if (!tokens.length) {
      await this.log('push', template, locale, msg.body, 'skipped', 'no_token', ctx);
      return false;
    }
    let any = false;
    for (const t of tokens) {
      const r = await this.push.send({ token: t.token, title: msg.title, body: msg.body, data, urgent });
      if (r.invalidToken) await this.repo.removeToken(t.token);
      any ||= r.ok;
      await this.log('push', template, locale, `${msg.title} — ${msg.body}`, r.ok ? 'sent' : 'failed', r.error ?? null, ctx);
    }
    return any;
  }

  private async sendMessage(
    channel: 'sms' | 'whatsapp' | 'voice',
    to: string,
    text: string,
    template: string,
    locale: Locale,
    ctx: { userId: string; merchantId: string | null; orderId: string | null },
  ): Promise<void> {
    const r = await this.messaging.send({ channel, to, text, template }).catch((err: Error) => ({ ok: false, error: err.message }));
    await this.log(channel, template, locale, text, r.ok ? 'sent' : 'failed', r.ok ? null : (r.error ?? 'failed'), ctx);
  }

  private async log(
    channel: Channel,
    template: string,
    locale: Locale,
    body: string,
    status: NotificationRecord['status'],
    error: string | null,
    ctx: { userId: string; merchantId: string | null; orderId: string | null },
  ): Promise<void> {
    await this.repo
      .log({ ...ctx, channel, template, locale, body, status, provider: channel === 'push' ? this.push.name : this.messaging.name, error })
      .catch((err: Error) => this.logger.warn(`comms log failed: ${err.message}`));
  }
}

const asLocale = (l: string): Locale => (l === 'te' ? 'te' : 'en');

function stateFor(type: string): string {
  return (
    {
      'order.placed': 'PLACED',
      'order.accepted': 'ACCEPTED',
      'order.preparing': 'PREPARING',
      'order.ready': 'READY',
      'order.rejected': 'REJECTED',
      'order.expired': 'EXPIRED',
      'order.cancelled': 'CANCELLED',
      'order.payment_failed': 'PAYMENT_FAILED',
    } as Record<string, string>
  )[type] ?? '';
}
