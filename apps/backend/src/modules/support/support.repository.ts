import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type SupportApp = 'consumer' | 'merchant' | 'rider';
export type ThreadStatus = 'waiting_support' | 'waiting_customer' | 'resolved';

export interface SupportThreadRecord {
  id: string;
  userId: string;
  app: SupportApp;
  orderId: string | null;
  orderCode: string | null;
  topic: string;
  status: ThreadStatus;
  assigneeId: string | null;
  lastMessageAt: Date;
  lastMessagePreview: string;
  unreadByUser: number;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface SupportMessageRecord {
  id: string;
  threadId: string;
  author: 'user' | 'support';
  authorId: string;
  body: string;
  createdAt: Date;
}

export type ThreadPatch = Partial<Pick<SupportThreadRecord, 'status' | 'assigneeId' | 'lastMessageAt' | 'lastMessagePreview' | 'unreadByUser' | 'resolvedAt'>>;

/** Storage port for support chat (ADR-028). Prisma in staging/production, in-memory in fake mode. */
export abstract class SupportRepository {
  abstract createThread(t: SupportThreadRecord, first: SupportMessageRecord): Promise<SupportThreadRecord>;
  abstract thread(id: string): Promise<SupportThreadRecord | null>;
  abstract threads(q: { userId?: string; statuses?: readonly ThreadStatus[]; orderId?: string; assigneeId?: string; limit: number }): Promise<SupportThreadRecord[]>;
  /** Adds a message and updates the thread in one transaction. */
  abstract addMessage(m: SupportMessageRecord, patch: ThreadPatch): Promise<SupportThreadRecord>;
  abstract updateThread(id: string, patch: ThreadPatch): Promise<SupportThreadRecord | null>;
  abstract messages(threadId: string): Promise<SupportMessageRecord[]>;
  /** Messages the requester sent to this thread since `since` (rate limit). */
  abstract userMessagesSince(threadId: string, since: Date): Promise<number>;
  abstract appendAudit(a: AuditEntry): Promise<void>;
}

const thread = (r: Record<string, unknown>) => r as unknown as SupportThreadRecord;
const message = (r: Record<string, unknown>) => r as unknown as SupportMessageRecord;

@Injectable()
export class PrismaSupportRepository extends SupportRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createThread(t: SupportThreadRecord, first: SupportMessageRecord) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.supportThread.create({ data: t });
      await tx.supportMessage.create({ data: first });
      return thread(row);
    });
  }

  async thread(id: string) {
    const r = await this.prisma.supportThread.findUnique({ where: { id } });
    return r && thread(r);
  }

  async threads(q: { userId?: string; statuses?: readonly ThreadStatus[]; orderId?: string; assigneeId?: string; limit: number }) {
    const rows = await this.prisma.supportThread.findMany({
      where: {
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.statuses ? { status: { in: [...q.statuses] } } : {}),
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: q.limit,
    });
    return rows.map(thread);
  }

  async addMessage(m: SupportMessageRecord, patch: ThreadPatch) {
    return this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({ data: m });
      const { unreadByUser, ...rest } = patch;
      const row = await tx.supportThread.update({
        where: { id: m.threadId },
        data: { ...rest, ...(unreadByUser === -1 ? { unreadByUser: { increment: 1 } } : unreadByUser != null ? { unreadByUser } : {}) },
      });
      return thread(row);
    });
  }

  async updateThread(id: string, patch: ThreadPatch) {
    const n = await this.prisma.supportThread.updateMany({ where: { id }, data: patch });
    return n.count ? this.thread(id) : null;
  }

  async messages(threadId: string) {
    return (await this.prisma.supportMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } })).map(message);
  }

  async userMessagesSince(threadId: string, since: Date) {
    return this.prisma.supportMessage.count({ where: { threadId, author: 'user', createdAt: { gte: since } } });
  }

  async appendAudit(a: AuditEntry) {
    await appendAudit(this.prisma, a);
  }
}

/** Fake mode (ADR-005). `unreadByUser: -1` in a patch means "one more". */
export class InMemorySupportRepository extends SupportRepository {
  private readonly t = new Map<string, SupportThreadRecord>();
  private readonly m: SupportMessageRecord[] = [];

  constructor(private readonly sinks: FakeSinks) {
    super();
  }

  private clone<T>(v: T): T {
    return structuredClone(v);
  }

  async createThread(t: SupportThreadRecord, first: SupportMessageRecord) {
    this.t.set(t.id, this.clone(t));
    this.m.push(this.clone(first));
    return this.clone(t);
  }

  async thread(id: string) {
    const t = this.t.get(id);
    return t ? this.clone(t) : null;
  }

  async threads(q: { userId?: string; statuses?: readonly ThreadStatus[]; orderId?: string; assigneeId?: string; limit: number }) {
    return this.clone(
      [...this.t.values()]
        .filter((x) => (!q.userId || x.userId === q.userId) && (!q.statuses || q.statuses.includes(x.status)) && (!q.orderId || x.orderId === q.orderId) && (!q.assigneeId || x.assigneeId === q.assigneeId))
        .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
        .slice(0, q.limit),
    );
  }

  async addMessage(m: SupportMessageRecord, patch: ThreadPatch) {
    this.m.push(this.clone(m));
    const t = this.t.get(m.threadId)!;
    const { unreadByUser, ...rest } = patch;
    Object.assign(t, this.clone(rest));
    if (unreadByUser === -1) t.unreadByUser += 1;
    else if (unreadByUser != null) t.unreadByUser = unreadByUser;
    return this.clone(t);
  }

  async updateThread(id: string, patch: ThreadPatch) {
    const t = this.t.get(id);
    if (!t) return null;
    Object.assign(t, this.clone(patch));
    return this.clone(t);
  }

  async messages(threadId: string) {
    return this.clone(this.m.filter((x) => x.threadId === threadId));
  }

  async userMessagesSince(threadId: string, since: Date) {
    return this.m.filter((x) => x.threadId === threadId && x.author === 'user' && x.createdAt >= since).length;
  }

  async appendAudit(a: AuditEntry) {
    this.sinks?.record([{ ...a, id: randomUUID(), createdAt: new Date() }]);
  }
}
