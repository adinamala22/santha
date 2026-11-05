import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { maskPhone } from '../../common/pii';
import { DispatchService } from '../dispatch-tracking/dispatch.service';
import { AuthService } from '../identity-kyc/auth.service';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { type SupportApp, type SupportMessageRecord, SupportRepository, type SupportThreadRecord, type ThreadStatus } from './support.repository';

/** What a chat can be about, per app (the app shows these as the first quick replies). */
export const SUPPORT_TOPICS = {
  consumer: ['order_late', 'missing_item', 'wrong_item', 'payment', 'refund', 'account', 'other'],
  merchant: ['orders', 'payout', 'catalogue', 'account', 'other'],
  rider: ['delivery', 'payout', 'app', 'account', 'other'],
} as const satisfies Record<SupportApp, readonly string[]>;
export const ALL_TOPICS = [...new Set(Object.values(SUPPORT_TOPICS).flat())] as const;

/** Unresolved chats one person may have at a time. */
export const MAX_OPEN_THREADS = 3;
/** A person's messages in one chat per 10 minutes (spam guard). */
export const MAX_MESSAGES_PER_10_MIN = 10;
/** A resolved chat can be reopened by writing to it within this time; after that, start a new one. */
export const REOPEN_WITHIN_DAYS = 7;

export interface OpsActor {
  userId: string;
  requestId: string | null;
}

/**
 * support — chat between customers, stores, riders and Santha support (ADR-028, PRD post-order "support chat").
 * Text only. Phone numbers are never shown to the other side; ops see the requester's masked phone.
 * Statuses: waiting_support (the requester wrote last) → waiting_customer (support replied) → resolved.
 * Every ops action (reply, assign, resolve) writes an audit row (without the message text).
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly repo: SupportRepository,
    private readonly orders: OrdersService,
    private readonly merchants: MerchantsService,
    private readonly dispatch: DispatchService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock();
  }

  // ───────────── requester (apps) ─────────────

  /**
   * Starts a chat, or adds to the open chat about the same order (one conversation per order). The order must be
   * the requester's: their own order (customer), their store's (partner), or one they deliver (rider).
   */
  async open(userId: string, app: SupportApp, input: { topic: string; orderId?: string | undefined; body: string }): Promise<SupportThreadRecord> {
    if (!(SUPPORT_TOPICS[app] as readonly string[]).includes(input.topic))
      throw new DomainError('VALIDATION_FAILED', 'Pick one of the topics.', { field: 'topic' });
    let orderCode: string | null = null;
    if (input.orderId) {
      orderCode = await this.orderCodeFor(userId, app, input.orderId);
      const same = (await this.repo.threads({ userId, orderId: input.orderId, statuses: ['waiting_support', 'waiting_customer'], limit: 1 }))[0];
      if (same) return this.write(userId, same.id, input.body);
    }
    const open = await this.repo.threads({ userId, statuses: ['waiting_support', 'waiting_customer'], limit: MAX_OPEN_THREADS + 1 });
    if (open.length >= MAX_OPEN_THREADS)
      throw new DomainError('RATE_LIMITED', 'You already have open chats with support. Reply in one of them.', { openThreads: open.length });
    const now = this.clock();
    const t: SupportThreadRecord = {
      id: randomUUID(),
      userId,
      app,
      orderId: input.orderId ?? null,
      orderCode,
      topic: input.topic,
      status: 'waiting_support',
      assigneeId: null,
      lastMessageAt: now,
      lastMessagePreview: preview(input.body),
      unreadByUser: 0,
      resolvedAt: null,
      createdAt: now,
    };
    return this.repo.createThread(t, { id: randomUUID(), threadId: t.id, author: 'user', authorId: userId, body: input.body, createdAt: now });
  }

  mine(userId: string): Promise<SupportThreadRecord[]> {
    return this.repo.threads({ userId, limit: 50 });
  }

  /** The requester opens a chat: its messages, and support's replies count as read. */
  async read(userId: string, threadId: string): Promise<{ thread: SupportThreadRecord; messages: SupportMessageRecord[] }> {
    let t = await this.ownThread(userId, threadId);
    if (t.unreadByUser > 0) t = (await this.repo.updateThread(t.id, { unreadByUser: 0 }))!;
    return { thread: t, messages: await this.repo.messages(t.id) };
  }

  /** The requester writes. Writing to a recently resolved chat reopens it. */
  async write(userId: string, threadId: string, body: string): Promise<SupportThreadRecord> {
    const t = await this.ownThread(userId, threadId);
    const now = this.clock();
    if (t.status === 'resolved' && t.resolvedAt && now.getTime() - t.resolvedAt.getTime() > REOPEN_WITHIN_DAYS * 86_400_000)
      throw new DomainError('INVALID_STATE', 'This chat is closed. Start a new one.', { state: 'resolved' });
    if ((await this.repo.userMessagesSince(t.id, new Date(now.getTime() - 10 * 60_000))) >= MAX_MESSAGES_PER_10_MIN)
      throw new DomainError('RATE_LIMITED', 'Please wait a few minutes before writing again.');
    const next = await this.repo.addMessage(
      { id: randomUUID(), threadId: t.id, author: 'user', authorId: userId, body, createdAt: now },
      { status: 'waiting_support', lastMessageAt: now, lastMessagePreview: preview(body), resolvedAt: null },
    );
    return next; // the console inbox refreshes itself
  }

  // ───────────── ops console ─────────────

  inbox(q: { statuses?: readonly ThreadStatus[]; assigneeId?: string; orderId?: string; limit?: number }): Promise<SupportThreadRecord[]> {
    return this.repo.threads({ ...q, limit: q.limit ?? 100 });
  }

  async opsThread(threadId: string): Promise<{ thread: SupportThreadRecord; messages: SupportMessageRecord[]; requester: { phoneMasked: string; name: string | null } }> {
    const t = await this.threadOrThrow(threadId);
    const user = await this.auth.me(t.userId).catch(() => null);
    return { thread: t, messages: await this.repo.messages(t.id), requester: { phoneMasked: user ? maskPhone(user.phone) : '—', name: user?.name ?? null } };
  }

  /** Support replies: the requester gets a push (SMS when the app has no token) and a live update. */
  async reply(threadId: string, body: string, ops: OpsActor): Promise<SupportThreadRecord> {
    const t = await this.threadOrThrow(threadId);
    const now = this.clock();
    const next = await this.repo.addMessage(
      { id: randomUUID(), threadId: t.id, author: 'support', authorId: ops.userId, body, createdAt: now },
      { status: 'waiting_customer', assigneeId: t.assigneeId ?? ops.userId, lastMessageAt: now, lastMessagePreview: preview(body), unreadByUser: -1, resolvedAt: null },
    );
    await this.audit(t, 'support.replied', ops, { status: t.status }, { status: 'waiting_customer', length: body.length });
    this.notifications.toRoom(`user:${t.userId}`, 'support.message', { threadId: t.id });
    await this.notifications.notify(
      'support.reply',
      { userId: t.userId },
      { code: t.orderCode ?? '' },
      { orderId: t.orderId },
      { data: { kind: 'support', threadId: t.id } },
    );
    return next;
  }

  async assign(threadId: string, ops: OpsActor): Promise<SupportThreadRecord> {
    const t = await this.threadOrThrow(threadId);
    const next = (await this.repo.updateThread(t.id, { assigneeId: ops.userId }))!;
    await this.audit(t, 'support.assigned', ops, { assigneeId: t.assigneeId }, { assigneeId: ops.userId });
    return next;
  }

  async resolve(threadId: string, ops: OpsActor): Promise<SupportThreadRecord> {
    const t = await this.threadOrThrow(threadId);
    if (t.status === 'resolved') return t;
    const next = (await this.repo.updateThread(t.id, { status: 'resolved', resolvedAt: this.clock(), assigneeId: t.assigneeId ?? ops.userId }))!;
    await this.audit(t, 'support.resolved', ops, { status: t.status }, { status: 'resolved' });
    this.notifications.toRoom(`user:${t.userId}`, 'support.message', { threadId: t.id });
    return next;
  }

  // ───────────── helpers ─────────────

  private async orderCodeFor(userId: string, app: SupportApp, orderId: string): Promise<string> {
    const o = await this.orders.get(orderId);
    const notYours = new DomainError('NOT_FOUND', 'Order not found');
    if (!o) throw notYours;
    if (app === 'consumer' && o.userId !== userId) throw notYours;
    if (app === 'merchant') {
      const mine = await this.merchants.mine(userId).catch(() => null);
      if (mine?.merchant.id !== o.merchantId) throw notYours;
    }
    if (app === 'rider' && (await this.dispatch.fulfilmentForOrder(orderId))?.riderUserId !== userId) throw notYours;
    return o.code;
  }

  private async ownThread(userId: string, id: string): Promise<SupportThreadRecord> {
    const t = await this.repo.thread(id);
    if (!t || t.userId !== userId) throw new DomainError('NOT_FOUND', 'Chat not found');
    return t;
  }

  private async threadOrThrow(id: string): Promise<SupportThreadRecord> {
    const t = await this.repo.thread(id);
    if (!t) throw new DomainError('NOT_FOUND', 'Chat not found');
    return t;
  }

  private audit(t: SupportThreadRecord, action: string, ops: OpsActor, before: Record<string, unknown>, after: Record<string, unknown>) {
    return this.repo.appendAudit({ entity: 'support_thread', entityId: t.id, action, actorId: ops.userId, requestId: ops.requestId, before, after });
  }
}

/** One line for inbox lists. */
const preview = (body: string) => (body.length > 120 ? `${body.slice(0, 117)}…` : body).replace(/\s+/g, ' ');
