import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type Channel = 'push' | 'sms' | 'whatsapp' | 'voice' | 'socket';

export interface NotificationRecord {
  id: string;
  userId: string | null;
  merchantId: string | null;
  orderId: string | null;
  channel: Channel;
  template: string;
  locale: string;
  body: string;
  status: 'sent' | 'failed' | 'skipped';
  provider: string;
  error: string | null;
  createdAt: Date;
}

export interface PushTokenRecord {
  deviceId: string;
  userId: string;
  token: string;
  platform: string;
  updatedAt: Date;
}

/** Storage port for notifications: the comms log, device push tokens and opt-ins. */
export abstract class NotificationRepository {
  abstract log(n: Omit<NotificationRecord, 'id' | 'createdAt'>): Promise<NotificationRecord>;
  /** Oldest first (a timeline). */
  abstract forOrder(orderId: string): Promise<NotificationRecord[]>;
  abstract forUser(userId: string, limit: number): Promise<NotificationRecord[]>;
  /** One token per device; re-registering a device replaces its token (and owner). */
  abstract upsertToken(t: Omit<PushTokenRecord, 'updatedAt'>): Promise<void>;
  abstract tokensFor(userId: string): Promise<PushTokenRecord[]>;
  abstract removeToken(token: string): Promise<void>;
  /** Sign-out: this phone stops getting the person's notifications. */
  abstract removeTokenForDevice(userId: string, deviceId: string): Promise<void>;
  abstract whatsappOptIn(userId: string): Promise<boolean>;
  abstract setWhatsappOptIn(userId: string, value: boolean): Promise<void>;
}

@Injectable()
export class PrismaNotificationRepository extends NotificationRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async log(n: Omit<NotificationRecord, 'id' | 'createdAt'>) {
    return (await this.prisma.notification.create({ data: n })) as NotificationRecord;
  }

  async forOrder(orderId: string) {
    return (await this.prisma.notification.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })) as NotificationRecord[];
  }

  async forUser(userId: string, limit: number) {
    return (await this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit })) as NotificationRecord[];
  }

  async upsertToken(t: Omit<PushTokenRecord, 'updatedAt'>) {
    const data = { userId: t.userId, token: t.token, platform: t.platform, updatedAt: new Date() };
    await this.prisma.pushToken.upsert({ where: { deviceId: t.deviceId }, create: { deviceId: t.deviceId, ...data }, update: data });
  }

  tokensFor(userId: string) {
    return this.prisma.pushToken.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
  }

  async removeToken(token: string) {
    await this.prisma.pushToken.deleteMany({ where: { token } });
  }

  async removeTokenForDevice(userId: string, deviceId: string) {
    await this.prisma.pushToken.deleteMany({ where: { userId, deviceId } });
  }

  async whatsappOptIn(userId: string) {
    return (await this.prisma.notificationPreference.findUnique({ where: { userId } }))?.whatsappUpdates ?? false;
  }

  async setWhatsappOptIn(userId: string, value: boolean) {
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, whatsappUpdates: value },
      update: { whatsappUpdates: value, updatedAt: new Date() },
    });
  }
}

/** Fake mode + tests. */
export class InMemoryNotificationRepository extends NotificationRepository {
  private readonly rows: NotificationRecord[] = [];
  private readonly tokens = new Map<string, PushTokenRecord>();
  private readonly optIns = new Map<string, boolean>();

  async log(n: Omit<NotificationRecord, 'id' | 'createdAt'>) {
    // Strictly increasing timestamps so timelines keep insertion order.
    const last = this.rows.at(-1)?.createdAt.getTime() ?? 0;
    const rec: NotificationRecord = { ...n, id: randomUUID(), createdAt: new Date(Math.max(Date.now(), last + 1)) };
    this.rows.push(rec);
    if (this.rows.length > 20_000) this.rows.splice(0, 5_000);
    return structuredClone(rec);
  }

  async forOrder(orderId: string) {
    return structuredClone(this.rows.filter((r) => r.orderId === orderId));
  }

  async forUser(userId: string, limit: number) {
    return structuredClone(this.rows.filter((r) => r.userId === userId).reverse().slice(0, limit));
  }

  async upsertToken(t: Omit<PushTokenRecord, 'updatedAt'>) {
    this.tokens.set(t.deviceId, { ...t, updatedAt: new Date() });
  }

  async tokensFor(userId: string) {
    return structuredClone([...this.tokens.values()].filter((t) => t.userId === userId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
  }

  async removeToken(token: string) {
    for (const [k, v] of this.tokens) if (v.token === token) this.tokens.delete(k);
  }

  async removeTokenForDevice(userId: string, deviceId: string) {
    const t = this.tokens.get(deviceId);
    if (t?.userId === userId) this.tokens.delete(deviceId);
  }

  async whatsappOptIn(userId: string) {
    return this.optIns.get(userId) ?? false;
  }

  async setWhatsappOptIn(userId: string, value: boolean) {
    this.optIns.set(userId, value);
  }
}
