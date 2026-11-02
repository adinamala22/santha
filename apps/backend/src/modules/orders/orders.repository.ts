import { Injectable } from '@nestjs/common';
import { Prisma, type Order, type OrderLine, type OrderState, type PaymentMethod } from '@prisma/client';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { MemoryStore } from '../../infra/fake/memory-tx';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { LIVE } from './domain/state-machine';

export type { OrderState, PaymentMethod };

export interface OrderAddress {
  addressId: string | null;
  label: string;
  name: string | null;
  line: string;
  landmark: string | null;
  pincode: string | null;
  location: { lat: number; lng: number };
}

export interface OrderLineRecord {
  itemId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number | null;
  linePaise: number;
  substitution: string;
  /** ok | removed | substituted (M5). */
  status?: 'ok' | 'removed' | 'substituted';
  substituteItemId?: string | null;
  substituteVariantId?: string | null;
  substituteName?: string | null;
  substituteVariantLabel?: string | null;
  substituteUnitPaise?: number | null;
  refundPaise?: number;
}

export interface OrderRecord<Q = unknown> {
  id: string;
  code: string;
  userId: string;
  merchantId: string;
  microMarketId: string;
  state: OrderState;
  paymentMethod: PaymentMethod;
  fulfilmentWhen: 'asap' | 'slot';
  slotId: string | null;
  slotDate: string | null;
  slotStartsAt: Date | null;
  address: OrderAddress;
  instructions: string | null;
  itemsPaise: number;
  feesPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
  promoCode: string | null;
  quote: Q;
  idempotencyKey: string;
  placedAt: Date | null;
  paymentDueAt: Date | null;
  /** M5 lifecycle. */
  fulfilmentMode: 'self' | 'rider' | null;
  acceptedAt: Date | null;
  readyAt: Date | null;
  packBy: Date | null;
  refundedPaise: number;
  outcomeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: OrderLineRecord[];
}

/** Columns that may change together with a state transition. */
export interface TransitionSet {
  placedAt?: Date;
  fulfilmentMode?: 'self' | 'rider';
  acceptedAt?: Date;
  readyAt?: Date;
  packBy?: Date;
  outcomeReason?: string;
}

export type NewOrder<Q = unknown> = Omit<OrderRecord<Q>, 'createdAt' | 'updatedAt' | 'fulfilmentMode' | 'acceptedAt' | 'readyAt' | 'packBy' | 'refundedPaise' | 'outcomeReason'> &
  Partial<Pick<OrderRecord<Q>, 'fulfilmentMode' | 'acceptedAt' | 'readyAt' | 'packBy' | 'refundedPaise' | 'outcomeReason'>>;

export interface TransitionRecord {
  from: OrderState | null;
  to: OrderState;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  at: Date;
}

export interface TransitionInput {
  from: OrderState;
  to: OrderState;
  actor: { type: string; id: string | null };
  reason?: string | null;
  /** Columns that change with the move (e.g. placedAt when it becomes PLACED). */
  set?: TransitionSet;
}

export interface OrderTx {
  insert<Q>(o: NewOrder<Q>, actor: { type: string; id: string | null }): Promise<OrderRecord<Q>>;
  /** Compare-and-swap on the current state. False when the order is no longer in `from`. */
  transition(orderId: string, t: TransitionInput): Promise<boolean>;
  /** Locks the order row for the rest of the transaction (line edits must not race transitions). */
  lock(orderId: string): Promise<OrderRecord | null>;
  /** Replaces one line's availability outcome and adds to the order's refunded total. */
  updateLine(orderId: string, variantId: string, patch: Pick<OrderLineRecord, 'status' | 'substituteItemId' | 'substituteVariantId' | 'substituteName' | 'substituteVariantLabel' | 'substituteUnitPaise' | 'refundPaise'>): Promise<void>;
  addRefund(orderId: string, paise: number): Promise<void>;
  appendEvent<P>(e: NewEvent<P>): Promise<void>;
  appendAudit(a: AuditEntry): Promise<void>;
}

/** Storage port for orders (the orders module owns these tables). */
export abstract class OrderRepository {
  abstract transaction<T>(fn: (tx: OrderTx) => Promise<T>): Promise<T>;
  abstract get(id: string): Promise<OrderRecord | null>;
  abstract getByIdempotencyKey(userId: string, key: string): Promise<OrderRecord | null>;
  /** Newest first. */
  abstract listForUser(userId: string, limit: number): Promise<OrderRecord[]>;
  abstract history(orderId: string): Promise<TransitionRecord[]>;
  /** Orders the user has really placed (anything past AWAITING_PAYMENT except PAYMENT_FAILED). */
  abstract countPlaced(userId: string): Promise<number>;
  /** Live (not terminal) COD orders of the user. */
  abstract countOpenCod(userId: string): Promise<number>;
  /** Orders holding a kitchen slot (live, or still awaiting payment), keyed `${slotId}|${date}`. */
  abstract slotBookings(merchantId: string, dates: string[]): Promise<Map<string, number>>;
  /** Portions of each item booked for a delivery date (kitchens' daily capacity). */
  abstract itemPortions(merchantId: string, date: string): Promise<Map<string, number>>;
  /** Online orders whose payment window has passed. */
  abstract awaitingPaymentDue(now: Date, limit: number): Promise<OrderRecord[]>;
  /** A store's orders (newest first), optionally only some states or since a time. */
  abstract listForMerchant(merchantId: string, q: { states?: OrderState[]; since?: Date; limit: number }): Promise<OrderRecord[]>;
  /** Ops: most recent orders, optionally in some states / one micro-market. */
  abstract listRecent(q: { states?: OrderState[]; microMarketId?: string; limit: number }): Promise<OrderRecord[]>;
}

/** States that hold capacity: live orders plus ones still waiting for payment. */
const HOLDING: OrderState[] = ['AWAITING_PAYMENT', ...LIVE];

// ───────────── Prisma ─────────────

type OrderRow = Order & { lines: OrderLine[] };

const toRecord = (o: OrderRow): OrderRecord => ({
  id: o.id,
  code: o.code,
  userId: o.userId,
  merchantId: o.merchantId,
  microMarketId: o.microMarketId,
  state: o.state,
  paymentMethod: o.paymentMethod,
  fulfilmentWhen: o.fulfilmentWhen as 'asap' | 'slot',
  slotId: o.slotId,
  slotDate: o.slotDate,
  slotStartsAt: o.slotStartsAt,
  address: o.address as unknown as OrderAddress,
  instructions: o.instructions,
  itemsPaise: o.itemsPaise,
  feesPaise: o.feesPaise,
  taxPaise: o.taxPaise,
  discountPaise: o.discountPaise,
  totalPaise: o.totalPaise,
  promoCode: o.promoCode,
  quote: o.quote,
  idempotencyKey: o.idempotencyKey,
  placedAt: o.placedAt,
  paymentDueAt: o.paymentDueAt,
  fulfilmentMode: (o.fulfilmentMode as 'self' | 'rider' | null) ?? null,
  acceptedAt: o.acceptedAt,
  readyAt: o.readyAt,
  packBy: o.packBy,
  refundedPaise: o.refundedPaise,
  outcomeReason: o.outcomeReason,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
  lines: [...o.lines]
    .sort((a, b) => a.position - b.position)
    .map((l) => ({
      itemId: l.itemId,
      variantId: l.variantId,
      name: l.name,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      mrpPaise: l.mrpPaise,
      linePaise: l.linePaise,
      substitution: l.substitution,
      status: l.status as 'ok' | 'removed' | 'substituted',
      substituteItemId: l.substituteItemId,
      substituteVariantId: l.substituteVariantId,
      substituteName: l.substituteName,
      substituteVariantLabel: l.substituteVariantLabel,
      substituteUnitPaise: l.substituteUnitPaise,
      refundPaise: l.refundPaise,
    })),
});

const withLines = { lines: true } as const;

class PrismaOrderTx implements OrderTx {
  constructor(private readonly tx: Tx) {}

  async insert<Q>(o: NewOrder<Q>, actor: { type: string; id: string | null }) {
    const { lines, address, quote, ...rest } = o;
    const row = await this.tx.order.create({
      data: {
        ...rest,
        address: address as unknown as Prisma.InputJsonValue,
        quote: quote as unknown as Prisma.InputJsonValue,
        lines: { create: lines.map((l, position) => ({ ...l, status: l.status ?? 'ok', refundPaise: l.refundPaise ?? 0, position })) },
        history: { create: { from: null, to: o.state, actorType: actor.type, actorId: actor.id } },
      },
      include: withLines,
    });
    return toRecord(row) as OrderRecord<Q>;
  }

  async transition(orderId: string, t: TransitionInput) {
    const { count } = await this.tx.order.updateMany({
      where: { id: orderId, state: t.from },
      data: { state: t.to, updatedAt: new Date(), ...(t.set ?? {}) },
    });
    if (count !== 1) return false;
    await this.tx.orderTransition.create({ data: { orderId, from: t.from, to: t.to, actorType: t.actor.type, actorId: t.actor.id, reason: t.reason ?? null } });
    return true;
  }

  async lock(orderId: string) {
    await this.tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const o = await this.tx.order.findUnique({ where: { id: orderId }, include: withLines });
    return o ? toRecord(o) : null;
  }

  async updateLine(orderId: string, variantId: string, patch: Parameters<OrderTx['updateLine']>[2]) {
    await this.tx.orderLine.updateMany({ where: { orderId, variantId }, data: patch });
  }

  async addRefund(orderId: string, paise: number) {
    await this.tx.order.update({ where: { id: orderId }, data: { refundedPaise: { increment: paise }, updatedAt: new Date() } });
  }

  async appendEvent<P>(e: NewEvent<P>) {
    await appendToOutbox(this.tx, e);
  }

  async appendAudit(a: AuditEntry) {
    await appendAudit(this.tx, a);
  }
}

@Injectable()
export class PrismaOrderRepository extends OrderRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  transaction<T>(fn: (tx: OrderTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaOrderTx(tx)), { timeout: 30_000, maxWait: 10_000 });
  }

  async get(id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: withLines });
    return o ? toRecord(o) : null;
  }

  async getByIdempotencyKey(userId: string, key: string) {
    const o = await this.prisma.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } }, include: withLines });
    return o ? toRecord(o) : null;
  }

  async listForUser(userId: string, limit: number) {
    return (await this.prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit, include: withLines })).map(toRecord);
  }

  async history(orderId: string) {
    return (await this.prisma.orderTransition.findMany({ where: { orderId }, orderBy: { at: 'asc' } })).map((h) => ({
      from: h.from,
      to: h.to,
      actorType: h.actorType,
      actorId: h.actorId,
      reason: h.reason,
      at: h.at,
    }));
  }

  countPlaced(userId: string) {
    return this.prisma.order.count({ where: { userId, state: { notIn: ['AWAITING_PAYMENT', 'PAYMENT_FAILED'] } } });
  }

  countOpenCod(userId: string) {
    return this.prisma.order.count({ where: { userId, paymentMethod: 'cod', state: { in: [...LIVE] } } });
  }

  async slotBookings(merchantId: string, dates: string[]) {
    const rows = await this.prisma.order.groupBy({
      by: ['slotId', 'slotDate'],
      where: { merchantId, slotId: { not: null }, slotDate: { in: dates }, state: { in: HOLDING } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [`${r.slotId}|${r.slotDate}`, r._count._all]));
  }

  async itemPortions(merchantId: string, date: string) {
    const rows = await this.prisma.orderLine.groupBy({
      by: ['itemId'],
      where: { order: { merchantId, slotDate: date, state: { in: HOLDING } } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.itemId, r._sum.quantity ?? 0]));
  }

  async awaitingPaymentDue(now: Date, limit: number) {
    return (
      await this.prisma.order.findMany({ where: { state: 'AWAITING_PAYMENT', paymentDueAt: { lte: now } }, orderBy: { paymentDueAt: 'asc' }, take: limit, include: withLines })
    ).map(toRecord);
  }

  async listForMerchant(merchantId: string, q: { states?: OrderState[]; since?: Date; limit: number }) {
    return (
      await this.prisma.order.findMany({
        where: { merchantId, ...(q.states ? { state: { in: q.states } } : {}), ...(q.since ? { createdAt: { gte: q.since } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        include: withLines,
      })
    ).map(toRecord);
  }

  async listRecent(q: { states?: OrderState[]; microMarketId?: string; limit: number }) {
    return (
      await this.prisma.order.findMany({
        where: { ...(q.states ? { state: { in: q.states } } : {}), ...(q.microMarketId ? { microMarketId: q.microMarketId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        include: withLines,
      })
    ).map(toRecord);
  }
}

// ───────────── in-memory (fake mode + tests) ─────────────

interface State {
  orders: OrderRecord[];
  history: Array<TransitionRecord & { orderId: string }>;
}

class OrderStore extends MemoryStore<State> {
  constructor(sinks?: FakeSinks) {
    super({ orders: [], history: [] }, sinks);
  }

  read<T>(fn: (s: State) => T): T {
    return this.clone(fn(this.state));
  }

  tx<T>(fn: (tx: OrderTx) => Promise<T>): Promise<T> {
    return this.runTx((fx) =>
      fn({
        insert: async (o, actor) => {
          if (this.state.orders.some((x) => x.id === o.id || x.code === o.code || (x.userId === o.userId && x.idempotencyKey === o.idempotencyKey)))
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'memory' });
          // Strictly increasing timestamps, like Postgres' microsecond now().
          const last = Math.max(0, ...this.state.orders.map((r) => r.createdAt.getTime()));
          const now = new Date(Math.max(Date.now(), last + 1));
          const rec = {
            fulfilmentMode: null,
            acceptedAt: null,
            readyAt: null,
            packBy: null,
            refundedPaise: 0,
            outcomeReason: null,
            ...this.clone(o),
            lines: o.lines.map((l) => ({ status: 'ok' as const, substituteItemId: null, substituteVariantId: null, substituteName: null, substituteVariantLabel: null, substituteUnitPaise: null, refundPaise: 0, ...this.clone(l) })),
            createdAt: now,
            updatedAt: now,
          } as OrderRecord;
          this.state.orders.push(rec);
          this.state.history.push({ orderId: o.id, from: null, to: o.state, actorType: actor.type, actorId: actor.id, reason: null, at: now });
          return this.clone(rec) as never;
        },
        transition: async (orderId, t) => {
          const o = this.state.orders.find((x) => x.id === orderId);
          if (!o || o.state !== t.from) return false;
          o.state = t.to;
          o.updatedAt = new Date();
          Object.assign(o, this.clone(t.set ?? {}));
          this.state.history.push({ orderId, from: t.from, to: t.to, actorType: t.actor.type, actorId: t.actor.id, reason: t.reason ?? null, at: new Date() });
          return true;
        },
        lock: async (orderId) => this.clone(this.state.orders.find((x) => x.id === orderId) ?? null),
        updateLine: async (orderId, variantId, patch) => {
          const o = this.state.orders.find((x) => x.id === orderId);
          const l = o?.lines.find((x) => x.variantId === variantId);
          if (l) Object.assign(l, this.clone(patch));
          if (o) o.updatedAt = new Date();
        },
        addRefund: async (orderId, paise) => {
          const o = this.state.orders.find((x) => x.id === orderId);
          if (o) {
            o.refundedPaise += paise;
            o.updatedAt = new Date();
          }
        },
        appendEvent: async (e) => fx.event(e),
        appendAudit: async (a) => fx.audit(a),
      }),
    );
  }
}

export class InMemoryOrderRepository extends OrderRepository {
  private readonly store: OrderStore;

  constructor(sinks?: FakeSinks) {
    super();
    this.store = new OrderStore(sinks);
  }

  transaction<T>(fn: (tx: OrderTx) => Promise<T>): Promise<T> {
    return this.store.tx(fn);
  }

  async get(id: string) {
    return this.store.read((s) => s.orders.find((o) => o.id === id) ?? null);
  }

  async getByIdempotencyKey(userId: string, key: string) {
    return this.store.read((s) => s.orders.find((o) => o.userId === userId && o.idempotencyKey === key) ?? null);
  }

  async listForUser(userId: string, limit: number) {
    return this.store.read((s) =>
      s.orders
        .filter((o) => o.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit),
    );
  }

  async history(orderId: string) {
    return this.store.read((s) => s.history.filter((h) => h.orderId === orderId).map(({ orderId: _, ...h }) => h));
  }

  async countPlaced(userId: string) {
    return this.store.read((s) => s.orders.filter((o) => o.userId === userId && o.state !== 'AWAITING_PAYMENT' && o.state !== 'PAYMENT_FAILED').length);
  }

  async countOpenCod(userId: string) {
    return this.store.read((s) => s.orders.filter((o) => o.userId === userId && o.paymentMethod === 'cod' && LIVE.includes(o.state)).length);
  }

  async slotBookings(merchantId: string, dates: string[]) {
    const m = new Map<string, number>();
    for (const o of this.store.read((s) => s.orders))
      if (o.merchantId === merchantId && o.slotId && o.slotDate && dates.includes(o.slotDate) && HOLDING.includes(o.state)) {
        const k = `${o.slotId}|${o.slotDate}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    return m;
  }

  async itemPortions(merchantId: string, date: string) {
    const m = new Map<string, number>();
    for (const o of this.store.read((s) => s.orders))
      if (o.merchantId === merchantId && o.slotDate === date && HOLDING.includes(o.state))
        for (const l of o.lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.quantity);
    return m;
  }

  async awaitingPaymentDue(now: Date, limit: number) {
    return this.store.read((s) =>
      s.orders
        .filter((o) => o.state === 'AWAITING_PAYMENT' && o.paymentDueAt && o.paymentDueAt <= now)
        .sort((a, b) => a.paymentDueAt!.getTime() - b.paymentDueAt!.getTime())
        .slice(0, limit),
    );
  }

  async listForMerchant(merchantId: string, q: { states?: OrderState[]; since?: Date; limit: number }) {
    return this.store.read((s) =>
      s.orders
        .filter((o) => o.merchantId === merchantId && (!q.states || q.states.includes(o.state)) && (!q.since || o.createdAt >= q.since))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  async listRecent(q: { states?: OrderState[]; microMarketId?: string; limit: number }) {
    return this.store.read((s) =>
      s.orders
        .filter((o) => (!q.states || q.states.includes(o.state)) && (!q.microMarketId || o.microMarketId === q.microMarketId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }
}
