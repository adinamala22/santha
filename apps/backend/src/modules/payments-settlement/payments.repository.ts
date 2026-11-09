import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentIntent, type PaymentStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { MemoryStore } from '../../infra/fake/memory-tx';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';

export type { PaymentStatus };

export interface PaymentIntentRecord {
  id: string;
  orderId: string;
  userId: string;
  microMarketId: string;
  amountPaise: number;
  currency: string;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  status: PaymentStatus;
  failureReason: string | null;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A tip paid after the delivery (ADR-037). */
export interface TipPaymentRecord {
  id: string;
  orderId: string;
  userId: string;
  riderUserId: string;
  microMarketId: string;
  amountPaise: number;
  currency: string;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  status: PaymentStatus;
  failureReason: string | null;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletEntryRecord {
  id: string;
  userId: string;
  amountPaise: number;
  kind: 'refund_credit' | 'adjustment';
  orderId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface PaymentsTx {
  insertIntent(i: Omit<PaymentIntentRecord, 'createdAt' | 'updatedAt' | 'providerPaymentId' | 'failureReason' | 'capturedAt' | 'status'>): Promise<PaymentIntentRecord>;
  /**
   * created|failed → captured (compare-and-swap); false if already captured. A capture after the
   * intent failed (the order lapsed) is still recorded so the money can be credited back.
   */
  markCaptured(id: string, providerPaymentId: string, at: Date): Promise<boolean>;
  insertTip(t: Omit<TipPaymentRecord, 'createdAt' | 'updatedAt' | 'providerPaymentId' | 'failureReason' | 'capturedAt' | 'status'>): Promise<TipPaymentRecord>;
  /** created|failed → captured (compare-and-swap); false if already captured. */
  markTipCaptured(id: string, providerPaymentId: string, at: Date): Promise<boolean>;
  /** Records the last failed attempt without ending the tip (the customer may retry). */
  noteTipFailure(id: string, reason: string): Promise<void>;
  /** created → failed (compare-and-swap). */
  markFailed(id: string, reason: string): Promise<boolean>;
  /** Records the last failed attempt without ending the intent (the customer may retry). */
  noteFailure(id: string, reason: string): Promise<void>;
  /** Stores a verified webhook; false when this provider event was already stored (duplicate delivery). */
  insertWebhook(w: { provider: string; providerEventId: string; eventType: string; payload: unknown }): Promise<boolean>;
  markWebhookProcessed(provider: string, providerEventId: string): Promise<void>;
  addWalletEntry(e: Omit<WalletEntryRecord, 'id' | 'createdAt'>): Promise<WalletEntryRecord>;
  appendEvent<P>(e: NewEvent<P>): Promise<void>;
  appendAudit(a: AuditEntry): Promise<void>;
}

/** Storage port for payments-settlement: payment intents, raw webhooks, wallet ledger. */
export abstract class PaymentsRepository {
  abstract transaction<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T>;
  abstract getIntent(id: string): Promise<PaymentIntentRecord | null>;
  abstract intentForOrder(orderId: string): Promise<PaymentIntentRecord | null>;
  abstract intentByProviderOrder(providerOrderId: string): Promise<PaymentIntentRecord | null>;
  abstract getTip(id: string): Promise<TipPaymentRecord | null>;
  abstract tipByProviderOrder(providerOrderId: string): Promise<TipPaymentRecord | null>;
  /** Tips for one order, newest first. */
  abstract tipsForOrder(orderId: string): Promise<TipPaymentRecord[]>;
  /** Captured tips for a rider with capturedAt in [from, to) (payouts). */
  abstract capturedTipsForRider(riderUserId: string, from: Date, to: Date): Promise<TipPaymentRecord[]>;
  abstract walletBalance(userId: string): Promise<number>;
  /** Newest first. */
  abstract walletEntries(userId: string, limit: number): Promise<WalletEntryRecord[]>;
  /** Captured payments with capturedAt in [from, to) (reconciliation, M7). */
  abstract capturedBetween(from: Date, to: Date): Promise<PaymentIntentRecord[]>;
  /** Captured tips with capturedAt in [from, to): they are in the aggregator report too (ADR-037). */
  abstract capturedTipsBetween(from: Date, to: Date): Promise<TipPaymentRecord[]>;
}

// ───────────── Prisma ─────────────

const toIntent = (i: PaymentIntent): PaymentIntentRecord => ({ ...i });

class PrismaPaymentsTx implements PaymentsTx {
  constructor(private readonly tx: Tx) {}

  async insertIntent(i: Parameters<PaymentsTx['insertIntent']>[0]) {
    return toIntent(await this.tx.paymentIntent.create({ data: { ...i, status: 'created' } }));
  }

  async markCaptured(id: string, providerPaymentId: string, at: Date) {
    const { count } = await this.tx.paymentIntent.updateMany({
      where: { id, status: { in: ['created', 'failed'] } },
      data: { status: 'captured', providerPaymentId, capturedAt: at, updatedAt: new Date() },
    });
    return count === 1;
  }

  async insertTip(t: Parameters<PaymentsTx['insertTip']>[0]) {
    return (await this.tx.tipPayment.create({ data: { ...t, status: 'created' } })) as TipPaymentRecord;
  }

  async markTipCaptured(id: string, providerPaymentId: string, at: Date) {
    const { count } = await this.tx.tipPayment.updateMany({
      where: { id, status: { in: ['created', 'failed'] } },
      data: { status: 'captured', providerPaymentId, capturedAt: at, updatedAt: new Date() },
    });
    return count === 1;
  }

  async noteTipFailure(id: string, reason: string) {
    await this.tx.tipPayment.updateMany({ where: { id, status: 'created' }, data: { failureReason: reason, updatedAt: new Date() } });
  }

  async markFailed(id: string, reason: string) {
    const { count } = await this.tx.paymentIntent.updateMany({ where: { id, status: 'created' }, data: { status: 'failed', failureReason: reason, updatedAt: new Date() } });
    return count === 1;
  }

  async noteFailure(id: string, reason: string) {
    await this.tx.paymentIntent.updateMany({ where: { id, status: 'created' }, data: { failureReason: reason, updatedAt: new Date() } });
  }

  async insertWebhook(w: { provider: string; providerEventId: string; eventType: string; payload: unknown }) {
    const { count } = await this.tx.webhookEvent.createMany({
      data: [{ ...w, payload: w.payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async markWebhookProcessed(provider: string, providerEventId: string) {
    await this.tx.webhookEvent.update({ where: { provider_providerEventId: { provider, providerEventId } }, data: { processedAt: new Date() } });
  }

  async addWalletEntry(e: Omit<WalletEntryRecord, 'id' | 'createdAt'>) {
    const r = await this.tx.walletEntry.create({ data: e });
    return { ...r, kind: r.kind as WalletEntryRecord['kind'] };
  }

  async appendEvent<P>(e: NewEvent<P>) {
    await appendToOutbox(this.tx, e);
  }

  async appendAudit(a: AuditEntry) {
    await appendAudit(this.tx, a);
  }
}

@Injectable()
export class PrismaPaymentsRepository extends PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  transaction<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaPaymentsTx(tx)));
  }

  async getIntent(id: string) {
    const i = await this.prisma.paymentIntent.findUnique({ where: { id } });
    return i ? toIntent(i) : null;
  }

  async intentForOrder(orderId: string) {
    const i = await this.prisma.paymentIntent.findUnique({ where: { orderId } });
    return i ? toIntent(i) : null;
  }

  async intentByProviderOrder(providerOrderId: string) {
    const i = await this.prisma.paymentIntent.findUnique({ where: { providerOrderId } });
    return i ? toIntent(i) : null;
  }

  async getTip(id: string) {
    return (await this.prisma.tipPayment.findUnique({ where: { id } })) as TipPaymentRecord | null;
  }

  async tipByProviderOrder(providerOrderId: string) {
    return (await this.prisma.tipPayment.findUnique({ where: { providerOrderId } })) as TipPaymentRecord | null;
  }

  async tipsForOrder(orderId: string) {
    return (await this.prisma.tipPayment.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } })) as TipPaymentRecord[];
  }

  async capturedTipsForRider(riderUserId: string, from: Date, to: Date) {
    return (await this.prisma.tipPayment.findMany({ where: { riderUserId, status: 'captured', capturedAt: { gte: from, lt: to } } })) as TipPaymentRecord[];
  }

  async walletBalance(userId: string) {
    const r = await this.prisma.walletEntry.aggregate({ where: { userId }, _sum: { amountPaise: true } });
    return r._sum.amountPaise ?? 0;
  }

  async capturedBetween(from: Date, to: Date) {
    return (await this.prisma.paymentIntent.findMany({ where: { status: 'captured', capturedAt: { gte: from, lt: to } } })) as PaymentIntentRecord[];
  }

  async capturedTipsBetween(from: Date, to: Date) {
    return (await this.prisma.tipPayment.findMany({ where: { status: 'captured', capturedAt: { gte: from, lt: to } } })) as TipPaymentRecord[];
  }

  async walletEntries(userId: string, limit: number) {
    return (await this.prisma.walletEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit })).map((r) => ({
      ...r,
      kind: r.kind as WalletEntryRecord['kind'],
    }));
  }
}

// ───────────── in-memory (fake mode + tests) ─────────────

interface State {
  intents: PaymentIntentRecord[];
  tips: TipPaymentRecord[];
  webhooks: Array<{ provider: string; providerEventId: string; eventType: string; payload: unknown; receivedAt: Date; processedAt: Date | null }>;
  wallet: WalletEntryRecord[];
}

class PaymentsStore extends MemoryStore<State> {
  constructor(sinks?: FakeSinks) {
    super({ intents: [], tips: [], webhooks: [], wallet: [] }, sinks);
  }

  read<T>(fn: (s: State) => T): T {
    return this.clone(fn(this.state));
  }

  tx<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T> {
    const intent = (id: string) => this.state.intents.find((x) => x.id === id);
    return this.runTx((fx) =>
      fn({
        insertIntent: async (i) => {
          if (this.state.intents.some((x) => x.orderId === i.orderId || x.providerOrderId === i.providerOrderId))
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'memory' });
          const now = new Date();
          const rec: PaymentIntentRecord = { ...this.clone(i), status: 'created', providerPaymentId: null, failureReason: null, capturedAt: null, createdAt: now, updatedAt: now };
          this.state.intents.push(rec);
          return this.clone(rec);
        },
        markCaptured: async (id, providerPaymentId, at) => {
          const i = intent(id);
          if (!i || i.status === 'captured') return false;
          Object.assign(i, { status: 'captured', providerPaymentId, capturedAt: at, updatedAt: new Date() });
          return true;
        },
        insertTip: async (t) => {
          if (this.state.tips.some((x) => x.providerOrderId === t.providerOrderId))
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'memory' });
          const now = new Date();
          const rec: TipPaymentRecord = { ...this.clone(t), status: 'created', providerPaymentId: null, failureReason: null, capturedAt: null, createdAt: now, updatedAt: now };
          this.state.tips.push(rec);
          return this.clone(rec);
        },
        markTipCaptured: async (id, providerPaymentId, at) => {
          const t = this.state.tips.find((x) => x.id === id);
          if (!t || t.status === 'captured') return false;
          Object.assign(t, { status: 'captured', providerPaymentId, capturedAt: at, updatedAt: new Date() });
          return true;
        },
        noteTipFailure: async (id, reason) => {
          const t = this.state.tips.find((x) => x.id === id);
          if (t?.status === 'created') Object.assign(t, { failureReason: reason, updatedAt: new Date() });
        },
        markFailed: async (id, reason) => {
          const i = intent(id);
          if (!i || i.status !== 'created') return false;
          Object.assign(i, { status: 'failed', failureReason: reason, updatedAt: new Date() });
          return true;
        },
        noteFailure: async (id, reason) => {
          const i = intent(id);
          if (i?.status === 'created') Object.assign(i, { failureReason: reason, updatedAt: new Date() });
        },
        insertWebhook: async (w) => {
          if (this.state.webhooks.some((x) => x.provider === w.provider && x.providerEventId === w.providerEventId)) return false;
          this.state.webhooks.push({ ...this.clone(w), receivedAt: new Date(), processedAt: null });
          return true;
        },
        markWebhookProcessed: async (provider, providerEventId) => {
          const w = this.state.webhooks.find((x) => x.provider === provider && x.providerEventId === providerEventId);
          if (w) w.processedAt = new Date();
        },
        addWalletEntry: async (e) => {
          const rec: WalletEntryRecord = { ...this.clone(e), id: randomUUID(), createdAt: new Date() };
          this.state.wallet.push(rec);
          return this.clone(rec);
        },
        appendEvent: async (e) => fx.event(e),
        appendAudit: async (a) => fx.audit(a),
      }),
    );
  }
}

export class InMemoryPaymentsRepository extends PaymentsRepository {
  private readonly store: PaymentsStore;

  constructor(sinks?: FakeSinks) {
    super();
    this.store = new PaymentsStore(sinks);
  }

  transaction<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T> {
    return this.store.tx(fn);
  }

  async getIntent(id: string) {
    return this.store.read((s) => s.intents.find((i) => i.id === id) ?? null);
  }

  async intentForOrder(orderId: string) {
    return this.store.read((s) => s.intents.find((i) => i.orderId === orderId) ?? null);
  }

  async intentByProviderOrder(providerOrderId: string) {
    return this.store.read((s) => s.intents.find((i) => i.providerOrderId === providerOrderId) ?? null);
  }

  async getTip(id: string) {
    return this.store.read((s) => s.tips.find((t) => t.id === id) ?? null);
  }

  async tipByProviderOrder(providerOrderId: string) {
    return this.store.read((s) => s.tips.find((t) => t.providerOrderId === providerOrderId) ?? null);
  }

  async tipsForOrder(orderId: string) {
    return this.store.read((s) => s.tips.filter((t) => t.orderId === orderId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }

  async capturedTipsForRider(riderUserId: string, from: Date, to: Date) {
    return this.store.read((s) => s.tips.filter((t) => t.riderUserId === riderUserId && t.status === 'captured' && t.capturedAt && t.capturedAt >= from && t.capturedAt < to));
  }

  async walletBalance(userId: string) {
    return this.store.read((s) => s.wallet.filter((w) => w.userId === userId).reduce((sum, w) => sum + w.amountPaise, 0));
  }

  async walletEntries(userId: string, limit: number) {
    return this.store.read((s) =>
      s.wallet
        .filter((w) => w.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit),
    );
  }

  async capturedTipsBetween(from: Date, to: Date) {
    return this.store.read((s) => s.tips.filter((t) => t.status === 'captured' && t.capturedAt && t.capturedAt >= from && t.capturedAt < to));
  }

  async capturedBetween(from: Date, to: Date) {
    return this.store.read((s) => s.intents.filter((i) => i.status === 'captured' && i.capturedAt && i.capturedAt >= from && i.capturedAt < to));
  }

  /** Stored webhooks (tests). */
  webhooks() {
    return this.store.read((s) => s.webhooks);
  }
}
