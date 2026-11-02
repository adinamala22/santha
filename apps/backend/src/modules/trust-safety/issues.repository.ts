import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
  createdAt: Date;
}

/** Storage port for trust-safety (M7): customer issues and ratings. */
export abstract class IssuesRepository {
  abstract createIssue(i: Omit<IssueRecord, 'createdAt' | 'decidedAt'>): Promise<IssueRecord>;
  abstract issue(id: string): Promise<IssueRecord | null>;
  abstract updateIssue(id: string, patch: Partial<Pick<IssueRecord, 'status' | 'decision' | 'refundId' | 'decidedAt'>>): Promise<IssueRecord | null>;
  abstract issues(q: { orderId?: string; userId?: string; merchantId?: string; statuses?: readonly IssueStatus[]; since?: Date; limit: number }): Promise<IssueRecord[]>;
  /** False when the order already has a rating. */
  abstract addRating(r: Omit<RatingRecord, 'createdAt'>): Promise<boolean>;
  abstract rating(orderId: string): Promise<RatingRecord | null>;
  abstract averages(q: { merchantId?: string; riderUserId?: string }): Promise<{ count: number; avg: number | null }>;
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

  async addRating(r: Omit<RatingRecord, 'createdAt'>) {
    try {
      await this.prisma.rating.create({ data: r });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false;
      throw e;
    }
  }

  async rating(orderId: string) {
    return this.prisma.rating.findUnique({ where: { orderId } });
  }

  async averages(q: { merchantId?: string; riderUserId?: string }) {
    if (q.riderUserId) {
      const a = await this.prisma.rating.aggregate({ where: { riderUserId: q.riderUserId, riderStars: { not: null } }, _avg: { riderStars: true }, _count: true });
      return { count: a._count, avg: a._avg.riderStars };
    }
    const a = await this.prisma.rating.aggregate({ where: { merchantId: q.merchantId }, _avg: { storeStars: true }, _count: true });
    return { count: a._count, avg: a._avg.storeStars };
  }
}

/** Fake mode + tests. */
export class InMemoryIssuesRepository extends IssuesRepository {
  private readonly rows: IssueRecord[] = [];
  private readonly ratings = new Map<string, RatingRecord>();

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

  async addRating(r: Omit<RatingRecord, 'createdAt'>) {
    if (this.ratings.has(r.orderId)) return false;
    this.ratings.set(r.orderId, { ...r, createdAt: new Date() });
    return true;
  }

  async rating(orderId: string) {
    return structuredClone(this.ratings.get(orderId) ?? null);
  }

  async averages(q: { merchantId?: string; riderUserId?: string }) {
    const stars = [...this.ratings.values()]
      .map((r) => (q.riderUserId ? (r.riderUserId === q.riderUserId ? r.riderStars : null) : r.merchantId === q.merchantId ? r.storeStars : null))
      .filter((s): s is number => s != null);
    return { count: stars.length, avg: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null };
  }
}
