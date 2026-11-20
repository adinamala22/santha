import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { buildEvent, type NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type IssueStatus = 'auto_resolved' | 'pending_review' | 'approved' | 'rejected' | 'return_pickup';

export interface IssueRecord {
  id: string;
  orderId: string;
  userId: string;
  merchantId: string;
  type: string;
  variantIds: string[];
  description: string | null;
  photoMediaIds: string[];
  claimedPaise: number;
  status: IssueStatus;
  trustScore: number;
  decision: Record<string, unknown>;
  refundId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface RatingRecord {
  orderId: string;
  userId: string;
  merchantId: string;
  riderUserId: string | null;
  storeStars: number;
  riderStars: number | null;
  comment: string | null;
  /** visible | flagged | hidden (M8 moderation). */
  status: 'visible' | 'flagged' | 'hidden';
  flagReason: string | null;
  reply: string | null;
  replyAt: Date | null;
  createdAt: Date;
}

/** One item the customer rated on an order (ADR-045). */
export interface ItemStar {
  itemId: string;
  stars: number;
}

/** An item's average and count across all customers. */
export interface ItemRatingSummary {
  avg: number;
  count: number;
}

export type RatingPatch = Partial<Pick<RatingRecord, 'status' | 'flagReason' | 'reply' | 'replyAt'>>;

/** A store's rating: average and count of store stars (hidden reviews excluded) and the 1–5 star breakdown. */
export interface StoreRatingSummary {
  count: number;
  avg: number | null;
  /** Counts for 1, 2, 3, 4 and 5 stars (index 0 is 1 star). */
  distribution: [number, number, number, number, number];
}

export function summarise(stars: readonly number[]): StoreRatingSummary {
  const distribution: StoreRatingSummary['distribution'] = [0, 0, 0, 0, 0];
  for (const s of stars) if (Number.isInteger(s) && s >= 1 && s <= 5) distribution[s - 1] = (distribution[s - 1] ?? 0) + 1;
  const count = distribution.reduce((a, b) => a + b, 0);
  const sum = distribution.reduce((a, n, i) => a + n * (i + 1), 0);
  return { count, avg: count ? Math.round((sum / count) * 100) / 100 : null, distribution };
}

/** Storage port for trust-safety (M7): customer issues and ratings. */
export abstract class IssuesRepository {
  abstract createIssue(i: Omit<IssueRecord, 'createdAt' | 'decidedAt'>): Promise<IssueRecord>;
  abstract issue(id: string): Promise<IssueRecord | null>;
  abstract updateIssue(id: string, patch: Partial<Pick<IssueRecord, 'status' | 'decision' | 'refundId' | 'decidedAt'>>): Promise<IssueRecord | null>;
  abstract issues(q: { orderId?: string; userId?: string; merchantId?: string; statuses?: readonly IssueStatus[]; since?: Date; limit: number }): Promise<IssueRecord[]>;
  /** False when the order already has a rating. `events` commit with the row (outbox). */
  abstract addRating(r: Omit<RatingRecord, 'createdAt' | 'status' | 'flagReason' | 'reply' | 'replyAt'> & Partial<Pick<RatingRecord, 'status' | 'flagReason'>>, events?: NewEvent[], itemStars?: readonly ItemStar[]): Promise<boolean>;
  /** The item stars given with this order's rating. */
  abstract itemStars(orderId: string): Promise<ItemStar[]>;
  /** Average and count of every rated item of a store, by item id (ADR-045). */
  abstract itemRatings(merchantId: string): Promise<Map<string, ItemRatingSummary>>;
  abstract updateRating(orderId: string, patch: RatingPatch, events?: NewEvent[]): Promise<RatingRecord | null>;
  /** Newest first. */
  abstract ratings(q: { merchantId?: string; statuses?: readonly RatingRecord['status'][]; limit: number }): Promise<RatingRecord[]>;
  abstract rating(orderId: string): Promise<RatingRecord | null>;
  abstract averages(q: { merchantId?: string; riderUserId?: string }): Promise<{ count: number; avg: number | null }>;
  /** Store stars of every review that is not hidden, summarised. */
  abstract storeSummary(merchantId: string): Promise<StoreRatingSummary>;
}

const asIssue = (r: Prisma.IssueGetPayload<object>) => r as unknown as IssueRecord;

@Injectable()
export class PrismaIssuesRepository extends IssuesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createIssue(i: Omit<IssueRecord, 'createdAt' | 'decidedAt'>) {
    return asIssue(await this.prisma.issue.create({ data: { ...i, decision: i.decision as Prisma.InputJsonValue } }));
  }

  async issue(id: string) {
    const r = await this.prisma.issue.findUnique({ where: { id } });
    return r && asIssue(r);
  }

  async updateIssue(id: string, patch: Partial<Pick<IssueRecord, 'status' | 'decision' | 'refundId' | 'decidedAt'>>) {
    const { decision, ...rest } = patch;
    const n = await this.prisma.issue.updateMany({ where: { id }, data: { ...rest, ...(decision ? { decision: decision as Prisma.InputJsonValue } : {}) } });
    return n.count ? this.issue(id) : null;
  }

  async issues(q: { orderId?: string; userId?: string; merchantId?: string; statuses?: readonly IssueStatus[]; since?: Date; limit: number }) {
    const rows = await this.prisma.issue.findMany({
      where: {
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.merchantId ? { merchantId: q.merchantId } : {}),
        ...(q.statuses ? { status: { in: [...q.statuses] } } : {}),
        ...(q.since ? { createdAt: { gte: q.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.map(asIssue);
  }

  async addRating(r: Omit<RatingRecord, 'createdAt' | 'status' | 'flagReason' | 'reply' | 'replyAt'> & Partial<Pick<RatingRecord, 'status' | 'flagReason'>>, events: NewEvent[] = [], itemStars: readonly ItemStar[] = []) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.rating.create({ data: r });
        if (itemStars.length) await tx.itemRating.createMany({ data: itemStars.map((i) => ({ orderId: r.orderId, itemId: i.itemId, merchantId: r.merchantId, userId: r.userId, stars: i.stars })) });
        for (const e of events) await appendToOutbox(tx, e);
      });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false;
      throw e;
    }
  }

  async rating(orderId: string) {
    return (await this.prisma.rating.findUnique({ where: { orderId } })) as RatingRecord | null;
  }

  async itemStars(orderId: string) {
    const rows = await this.prisma.itemRating.findMany({ where: { orderId }, orderBy: { itemId: 'asc' } });
    return rows.map((x) => ({ itemId: x.itemId, stars: x.stars }));
  }

  async itemRatings(merchantId: string) {
    const g = await this.prisma.itemRating.groupBy({ by: ['itemId'], where: { merchantId }, _avg: { stars: true }, _count: { _all: true } });
    return new Map(g.map((x) => [x.itemId, { avg: Math.round((x._avg.stars ?? 0) * 10) / 10, count: x._count._all }]));
  }

  async updateRating(orderId: string, patch: RatingPatch, events: NewEvent[] = []) {
    const n = await this.prisma.$transaction(async (tx) => {
      const u = await tx.rating.updateMany({ where: { orderId }, data: patch });
      if (u.count) for (const e of events) await appendToOutbox(tx, e);
      return u.count;
    });
    return n ? this.rating(orderId) : null;
  }

  async ratings(q: { merchantId?: string; statuses?: readonly RatingRecord['status'][]; limit: number }) {
    return (await this.prisma.rating.findMany({
      where: { ...(q.merchantId ? { merchantId: q.merchantId } : {}), ...(q.statuses ? { status: { in: [...q.statuses] } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    })) as RatingRecord[];
  }

  async averages(q: { merchantId?: string; riderUserId?: string }) {
    if (q.riderUserId) {
      const a = await this.prisma.rating.aggregate({ where: { riderUserId: q.riderUserId, riderStars: { not: null } }, _avg: { riderStars: true }, _count: true });
      return { count: a._count, avg: a._avg.riderStars };
    }
    const a = await this.prisma.rating.aggregate({ where: { merchantId: q.merchantId, status: { not: 'hidden' } }, _avg: { storeStars: true }, _count: true });
    return { count: a._count, avg: a._avg.storeStars };
  }

  async storeSummary(merchantId: string) {
    const g = await this.prisma.rating.groupBy({ by: ['storeStars'], where: { merchantId, status: { not: 'hidden' } }, _count: { _all: true } });
    return summarise(g.flatMap((x) => Array<number>(x._count._all).fill(x.storeStars)));
  }
}

/** Fake mode + tests. */
export class InMemoryIssuesRepository extends IssuesRepository {
  private readonly rows: IssueRecord[] = [];
  private readonly ratingRows = new Map<string, RatingRecord>();
  private readonly itemRows: Array<ItemStar & { orderId: string; merchantId: string }> = [];

  /** Fake mode passes the sinks so rating events reach their consumers (the search index); unit tests may omit them. */
  constructor(private readonly sinks?: FakeSinks) {
    super();
  }

  private async emit(events: NewEvent[]) {
    if (!events.length || !this.sinks) return;
    const built = events.map((e) => buildEvent(e));
    this.sinks.publish(built);
    await this.sinks.deliver(built);
  }

  async createIssue(i: Omit<IssueRecord, 'createdAt' | 'decidedAt'>) {
    const rec: IssueRecord = { ...structuredClone(i), createdAt: new Date(), decidedAt: null };
    this.rows.push(rec);
    return structuredClone(rec);
  }

  async issue(id: string) {
    return structuredClone(this.rows.find((r) => r.id === id) ?? null);
  }

  async updateIssue(id: string, patch: Partial<Pick<IssueRecord, 'status' | 'decision' | 'refundId' | 'decidedAt'>>) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, structuredClone(patch));
    return structuredClone(r);
  }

  async issues(q: { orderId?: string; userId?: string; merchantId?: string; statuses?: readonly IssueStatus[]; since?: Date; limit: number }) {
    return structuredClone(
      this.rows
        .filter(
          (r) =>
            (!q.orderId || r.orderId === q.orderId) &&
            (!q.userId || r.userId === q.userId) &&
            (!q.merchantId || r.merchantId === q.merchantId) &&
            (!q.statuses || q.statuses.includes(r.status)) &&
            (!q.since || r.createdAt >= q.since),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  async addRating(r: Omit<RatingRecord, 'createdAt' | 'status' | 'flagReason' | 'reply' | 'replyAt'> & Partial<Pick<RatingRecord, 'status' | 'flagReason'>>, events: NewEvent[] = [], itemStars: readonly ItemStar[] = []) {
    if (this.ratingRows.has(r.orderId)) return false;
    for (const i of itemStars) this.itemRows.push({ orderId: r.orderId, merchantId: r.merchantId, itemId: i.itemId, stars: i.stars });
    const last = Math.max(0, ...[...this.ratingRows.values()].map((x) => x.createdAt.getTime()));
    this.ratingRows.set(r.orderId, { status: 'visible', flagReason: null, reply: null, replyAt: null, ...r, createdAt: new Date(Math.max(Date.now(), last + 1)) });
    await this.emit(events);
    return true;
  }

  async updateRating(orderId: string, patch: RatingPatch, events: NewEvent[] = []) {
    const r = this.ratingRows.get(orderId);
    if (!r) return null;
    Object.assign(r, structuredClone(patch));
    const out = structuredClone(r);
    await this.emit(events);
    return out;
  }

  async ratings(q: { merchantId?: string; statuses?: readonly RatingRecord['status'][]; limit: number }) {
    return structuredClone(
      [...this.ratingRows.values()]
        .filter((r) => (!q.merchantId || r.merchantId === q.merchantId) && (!q.statuses || q.statuses.includes(r.status)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, q.limit),
    );
  }

  async rating(orderId: string) {
    return structuredClone(this.ratingRows.get(orderId) ?? null);
  }

  async itemStars(orderId: string) {
    return this.itemRows.filter((x) => x.orderId === orderId).map((x) => ({ itemId: x.itemId, stars: x.stars })).sort((a, b) => a.itemId.localeCompare(b.itemId));
  }

  async itemRatings(merchantId: string) {
    const by = new Map<string, number[]>();
    for (const x of this.itemRows) if (x.merchantId === merchantId) by.set(x.itemId, [...(by.get(x.itemId) ?? []), x.stars]);
    return new Map([...by].map(([id, st]) => [id, { avg: Math.round((st.reduce((a, b) => a + b, 0) / st.length) * 10) / 10, count: st.length }]));
  }

  async averages(q: { merchantId?: string; riderUserId?: string }) {
    const stars = [...this.ratingRows.values()]
      .filter((r) => q.riderUserId || r.status !== 'hidden')
      .map((r) => (q.riderUserId ? (r.riderUserId === q.riderUserId ? r.riderStars : null) : r.merchantId === q.merchantId ? r.storeStars : null))
      .filter((s): s is number => s != null);
    return { count: stars.length, avg: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null };
  }

  async storeSummary(merchantId: string) {
    return summarise([...this.ratingRows.values()].filter((r) => r.merchantId === merchantId && r.status !== 'hidden').map((r) => r.storeStars));
  }
}
