import { Injectable } from '@nestjs/common';
import { Prisma, type Promo, type PromoRedemption, type RedemptionStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { MemoryStore } from '../../infra/fake/memory-tx';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import type { Substitution } from './domain/pricing';
import type { PromoRecord } from './domain/promo';

export type { RedemptionStatus };

export interface CartLineRecord {
  itemId: string;
  variantId: string;
  quantity: number;
  substitution: Substitution;
}

export interface CartRecord {
  userId: string;
  merchantId: string;
  lines: CartLineRecord[];
  updatedAt: Date;
}

export interface QuoteRecord<S = unknown> {
  id: string;
  userId: string;
  merchantId: string;
  microMarketId: string;
  totalPaise: number;
  snapshot: S;
  createdAt: Date;
  expiresAt: Date;
}

export interface RedemptionRecord {
  id: string;
  promoId: string;
  userId: string;
  orderId: string;
  discountPaise: number;
  merchantSharePaise: number;
  status: RedemptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPromo = Omit<PromoRecord, 'id' | 'spentPaise' | 'createdAt' | 'updatedAt'>;
export type PromoPatch = Partial<Omit<PromoRecord, 'id' | 'code' | 'spentPaise' | 'createdAt' | 'updatedAt' | 'createdBy'>>;

/** Promo writes that must share a transaction with their event/audit row. */
export interface PromoTx {
  getPromo(id: string): Promise<PromoRecord | null>;
  createPromo(p: NewPromo): Promise<PromoRecord>;
  updatePromo(id: string, patch: PromoPatch): Promise<PromoRecord>;
  /**
   * Compare-and-swap budget reservation: adds `amount` to spent only if the promo is active and
   * the budget allows it. Returns false when it does not (budget exhausted / deactivated).
   */
  reserveBudget(promoId: string, amountPaise: number): Promise<boolean>;
  releaseBudget(promoId: string, amountPaise: number): Promise<void>;
  insertRedemption(r: Omit<RedemptionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<RedemptionRecord>;
  redemptionForOrder(orderId: string): Promise<RedemptionRecord | null>;
  /** Moves a redemption out of `from`; false if it was not in `from` (already handled). */
  setRedemptionStatus(orderId: string, from: RedemptionStatus, to: RedemptionStatus): Promise<boolean>;
  appendEvent<P>(e: NewEvent<P>): Promise<void>;
  appendAudit(a: AuditEntry): Promise<void>;
}

/** Storage port for cart-pricing: carts, quote snapshots, promos and their redemptions. */
export abstract class CartPricingRepository {
  abstract getCart(userId: string): Promise<CartRecord | null>;
  abstract putCart(cart: Omit<CartRecord, 'updatedAt'>): Promise<CartRecord>;
  abstract deleteCart(userId: string): Promise<void>;
  abstract saveQuote<S>(q: Omit<QuoteRecord<S>, 'createdAt'>): Promise<QuoteRecord<S>>;
  abstract getQuote<S>(id: string): Promise<QuoteRecord<S> | null>;
  abstract listPromos(): Promise<PromoRecord[]>;
  abstract getPromoByCode(code: string): Promise<PromoRecord | null>;
  abstract getPromo(id: string): Promise<PromoRecord | null>;
  /** Reserved + confirmed redemptions of a promo by a user. */
  abstract activeRedemptions(promoId: string, userId: string): Promise<number>;
  abstract transaction<T>(fn: (tx: PromoTx) => Promise<T>): Promise<T>;
}

// ───────────── Prisma ─────────────

const toPromo = (p: Promo): PromoRecord => ({ ...p });
const toRedemption = (r: PromoRedemption): RedemptionRecord => ({ ...r });

class PrismaPromoTx implements PromoTx {
  constructor(private readonly tx: Tx) {}

  async getPromo(id: string) {
    const p = await this.tx.promo.findUnique({ where: { id } });
    return p ? toPromo(p) : null;
  }

  async createPromo(p: NewPromo) {
    return toPromo(await this.tx.promo.create({ data: p }));
  }

  async updatePromo(id: string, patch: PromoPatch) {
    return toPromo(await this.tx.promo.update({ where: { id }, data: { ...patch, updatedAt: new Date() } }));
  }

  async reserveBudget(promoId: string, amountPaise: number) {
    const n = await this.tx.$executeRaw`
      UPDATE promos SET spent_paise = spent_paise + ${amountPaise}, updated_at = now()
      WHERE id = ${promoId}::uuid AND active AND (budget_paise IS NULL OR spent_paise + ${amountPaise} <= budget_paise)`;
    return n === 1;
  }

  async releaseBudget(promoId: string, amountPaise: number) {
    await this.tx.$executeRaw`UPDATE promos SET spent_paise = GREATEST(0, spent_paise - ${amountPaise}), updated_at = now() WHERE id = ${promoId}::uuid`;
  }

  async insertRedemption(r: Omit<RedemptionRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    return toRedemption(await this.tx.promoRedemption.create({ data: r }));
  }

  async redemptionForOrder(orderId: string) {
    const r = await this.tx.promoRedemption.findUnique({ where: { orderId } });
    return r ? toRedemption(r) : null;
  }

  async setRedemptionStatus(orderId: string, from: RedemptionStatus, to: RedemptionStatus) {
    const { count } = await this.tx.promoRedemption.updateMany({ where: { orderId, status: from }, data: { status: to, updatedAt: new Date() } });
    return count === 1;
  }

  async appendEvent<P>(e: NewEvent<P>) {
    await appendToOutbox(this.tx, e);
  }

  async appendAudit(a: AuditEntry) {
    await appendAudit(this.tx, a);
  }
}

@Injectable()
export class PrismaCartPricingRepository extends CartPricingRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async getCart(userId: string) {
    const c = await this.prisma.cart.findUnique({ where: { userId } });
    return c ? { userId: c.userId, merchantId: c.merchantId, lines: c.lines as unknown as CartLineRecord[], updatedAt: c.updatedAt } : null;
  }

  async putCart(cart: Omit<CartRecord, 'updatedAt'>) {
    const data = { merchantId: cart.merchantId, lines: cart.lines as unknown as Prisma.InputJsonValue, updatedAt: new Date() };
    const c = await this.prisma.cart.upsert({ where: { userId: cart.userId }, create: { userId: cart.userId, ...data }, update: data });
    return { userId: c.userId, merchantId: c.merchantId, lines: c.lines as unknown as CartLineRecord[], updatedAt: c.updatedAt };
  }

  async deleteCart(userId: string) {
    await this.prisma.cart.deleteMany({ where: { userId } });
  }

  async saveQuote<S>(q: Omit<QuoteRecord<S>, 'createdAt'>) {
    const r = await this.prisma.quote.create({ data: { ...q, snapshot: q.snapshot as unknown as Prisma.InputJsonValue } });
    return { ...r, snapshot: r.snapshot as S };
  }

  async getQuote<S>(id: string) {
    const r = await this.prisma.quote.findUnique({ where: { id } });
    return r ? { ...r, snapshot: r.snapshot as S } : null;
  }

  async listPromos() {
    return (await this.prisma.promo.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] })).map(toPromo);
  }

  async getPromoByCode(code: string) {
    const p = await this.prisma.promo.findUnique({ where: { code } });
    return p ? toPromo(p) : null;
  }

  async getPromo(id: string) {
    const p = await this.prisma.promo.findUnique({ where: { id } });
    return p ? toPromo(p) : null;
  }

  activeRedemptions(promoId: string, userId: string) {
    return this.prisma.promoRedemption.count({ where: { promoId, userId, status: { in: ['reserved', 'confirmed'] } } });
  }

  transaction<T>(fn: (tx: PromoTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaPromoTx(tx)));
  }
}

// ───────────── in-memory (fake mode + tests) ─────────────

interface State {
  carts: CartRecord[];
  quotes: QuoteRecord[];
  promos: PromoRecord[];
  redemptions: RedemptionRecord[];
}

class CartPricingStore extends MemoryStore<State> {
  constructor(sinks?: FakeSinks) {
    super({ carts: [], quotes: [], promos: [], redemptions: [] }, sinks);
  }

  read<T>(fn: (s: State) => T): T {
    return this.clone(fn(this.state));
  }

  write<T>(fn: (s: State) => T): T {
    return this.clone(fn(this.state));
  }

  tx<T>(fn: (tx: PromoTx) => Promise<T>): Promise<T> {
    const promo = (id: string) => {
      const p = this.state.promos.find((x) => x.id === id);
      if (!p) throw new Error(`promo ${id} not found`);
      return p;
    };
    return this.runTx((fx) =>
      fn({
        getPromo: async (id) => this.clone(this.state.promos.find((x) => x.id === id) ?? null),
        createPromo: async (p) => {
          if (this.state.promos.some((x) => x.code === p.code)) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on code', { code: 'P2002', clientVersion: 'memory' });
          const now = new Date();
          const rec: PromoRecord = { ...this.clone(p), id: randomUUID(), spentPaise: 0, createdAt: now, updatedAt: now };
          this.state.promos.push(rec);
          return this.clone(rec);
        },
        updatePromo: async (id, patch) => {
          const p = promo(id);
          Object.assign(p, this.clone(patch), { updatedAt: new Date() });
          return this.clone(p);
        },
        reserveBudget: async (id, amount) => {
          const p = promo(id);
          if (!p.active || (p.budgetPaise != null && p.spentPaise + amount > p.budgetPaise)) return false;
          p.spentPaise += amount;
          p.updatedAt = new Date();
          return true;
        },
        releaseBudget: async (id, amount) => {
          const p = promo(id);
          p.spentPaise = Math.max(0, p.spentPaise - amount);
          p.updatedAt = new Date();
        },
        insertRedemption: async (r) => {
          if (this.state.redemptions.some((x) => x.orderId === r.orderId)) throw new Error('redemption exists for order');
          const now = new Date();
          const rec: RedemptionRecord = { ...this.clone(r), id: randomUUID(), createdAt: now, updatedAt: now };
          this.state.redemptions.push(rec);
          return this.clone(rec);
        },
        redemptionForOrder: async (orderId) => this.clone(this.state.redemptions.find((r) => r.orderId === orderId) ?? null),
        setRedemptionStatus: async (orderId, from, to) => {
          const r = this.state.redemptions.find((x) => x.orderId === orderId && x.status === from);
          if (!r) return false;
          r.status = to;
          r.updatedAt = new Date();
          return true;
        },
        appendEvent: async (e) => fx.event(e),
        appendAudit: async (a) => fx.audit(a),
      }),
    );
  }
}

export class InMemoryCartPricingRepository extends CartPricingRepository {
  private readonly store: CartPricingStore;

  constructor(sinks?: FakeSinks) {
    super();
    this.store = new CartPricingStore(sinks);
  }

  async getCart(userId: string) {
    return this.store.read((s) => s.carts.find((c) => c.userId === userId) ?? null);
  }

  async putCart(cart: Omit<CartRecord, 'updatedAt'>) {
    return this.store.write((s) => {
      const rec: CartRecord = { ...structuredClone(cart), updatedAt: new Date() };
      s.carts = [...s.carts.filter((c) => c.userId !== cart.userId), rec];
      return rec;
    });
  }

  async deleteCart(userId: string) {
    this.store.write((s) => (s.carts = s.carts.filter((c) => c.userId !== userId)));
  }

  async saveQuote<S>(q: Omit<QuoteRecord<S>, 'createdAt'>) {
    return this.store.write((s) => {
      const rec = { ...structuredClone(q), createdAt: new Date() } as QuoteRecord;
      s.quotes.push(rec);
      if (s.quotes.length > 5000) s.quotes.splice(0, s.quotes.length - 5000);
      return rec as QuoteRecord<S>;
    });
  }

  async getQuote<S>(id: string) {
    return this.store.read((s) => (s.quotes.find((q) => q.id === id) ?? null) as QuoteRecord<S> | null);
  }

  async listPromos() {
    return this.store.read((s) => [...s.promos].sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt.getTime() - a.createdAt.getTime()));
  }

  async getPromoByCode(code: string) {
    return this.store.read((s) => s.promos.find((p) => p.code === code) ?? null);
  }

  async getPromo(id: string) {
    return this.store.read((s) => s.promos.find((p) => p.id === id) ?? null);
  }

  async activeRedemptions(promoId: string, userId: string) {
    return this.store.read((s) => s.redemptions.filter((r) => r.promoId === promoId && r.userId === userId && r.status !== 'released').length);
  }

  transaction<T>(fn: (tx: PromoTx) => Promise<T>): Promise<T> {
    return this.store.tx(fn);
  }

  /** Demo promos (fake-mode boot only). */
  seedPromos(promos: PromoRecord[]): void {
    this.store.write((s) => s.promos.push(...structuredClone(promos)));
  }
}
