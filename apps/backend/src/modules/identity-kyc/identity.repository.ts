import { Injectable } from '@nestjs/common';
import type { AppId, Platform, Role, UserStatus } from '@prisma/client';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';

export interface UserRecord {
  id: string;
  phone: string;
  name: string | null;
  locale: string;
  status: UserStatus;
  roles: Role[];
}

export interface ChallengeRecord {
  id: string;
  phone: string;
  deviceId: string;
  app: AppId;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  deviceInstallId: string;
  app: AppId;
  refreshHash: string;
  prevRefreshHash: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  user: UserRecord;
}

export interface DeviceInput {
  userId: string;
  deviceId: string;
  app: AppId;
  platform: Platform;
  appVersion?: string | undefined;
}

/** Operations that must run inside one transaction (state change + outbox event). */
export interface IdentityTx {
  consumeChallenge(id: string, now: Date): Promise<boolean>;
  findUserByPhone(phone: string): Promise<UserRecord | null>;
  createUser(phone: string): Promise<UserRecord>;
  /** Returns true when the role was newly granted. */
  grantRole(userId: string, role: Role, grantedBy: string | null): Promise<boolean>;
  upsertDevice(input: DeviceInput, now: Date): Promise<{ id: string }>;
  createSession(input: { id: string; userId: string; deviceRowId: string; refreshHash: string; expiresAt: Date }): Promise<void>;
  appendEvent<P>(event: NewEvent<P>): Promise<void>;
}

/** Storage port for identity-kyc. Only this module's code may touch these tables. */
export abstract class IdentityRepository {
  abstract transaction<T>(fn: (tx: IdentityTx) => Promise<T>): Promise<T>;
  abstract createChallenge(c: Omit<ChallengeRecord, 'attempts' | 'consumedAt'>): Promise<void>;
  abstract findChallenge(id: string): Promise<ChallengeRecord | null>;
  /** Atomically increments and returns the new attempt count. */
  abstract incrementAttempts(id: string): Promise<number>;
  abstract lastChallengeAt(phone: string): Promise<Date | null>;
  abstract findUserById(id: string): Promise<UserRecord | null>;
  abstract findSession(id: string): Promise<SessionRecord | null>;
  /** Compare-and-swap rotation; false if the session changed concurrently. */
  abstract rotateSession(id: string, expectedHash: string, newHash: string, expiresAt: Date, now: Date): Promise<boolean>;
  abstract revokeSession(id: string, reason: string, now: Date): Promise<void>;
}

const userSelect = {
  id: true,
  phone: true,
  name: true,
  locale: true,
  status: true,
  roles: { select: { role: true } },
} as const;

type UserRow = {
  id: string;
  phone: string;
  name: string | null;
  locale: string;
  status: UserStatus;
  roles: Array<{ role: Role }>;
};

const toUser = (u: UserRow): UserRecord => ({ ...u, roles: u.roles.map((r) => r.role) });

class PrismaIdentityTx implements IdentityTx {
  constructor(private readonly tx: Tx) {}

  async consumeChallenge(id: string, now: Date): Promise<boolean> {
    const { count } = await this.tx.otpChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: now },
    });
    return count === 1;
  }

  async findUserByPhone(phone: string): Promise<UserRecord | null> {
    const u = await this.tx.user.findUnique({ where: { phone }, select: userSelect });
    return u ? toUser(u) : null;
  }

  async createUser(phone: string): Promise<UserRecord> {
    return toUser(await this.tx.user.create({ data: { phone }, select: userSelect }));
  }

  async grantRole(userId: string, role: Role, grantedBy: string | null): Promise<boolean> {
    const { count } = await this.tx.userRole.createMany({
      data: [{ userId, role, grantedBy }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async upsertDevice(input: DeviceInput, now: Date): Promise<{ id: string }> {
    return this.tx.device.upsert({
      where: { userId_deviceId_app: { userId: input.userId, deviceId: input.deviceId, app: input.app } },
      create: { ...input, lastSeenAt: now },
      update: { platform: input.platform, appVersion: input.appVersion, lastSeenAt: now },
      select: { id: true },
    });
  }

  async createSession(input: {
    id: string;
    userId: string;
    deviceRowId: string;
    refreshHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.tx.session.create({ data: input });
  }

  async appendEvent<P>(event: NewEvent<P>): Promise<void> {
    await appendToOutbox(this.tx, event);
  }
}

@Injectable()
export class PrismaIdentityRepository extends IdentityRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  transaction<T>(fn: (tx: IdentityTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaIdentityTx(tx)));
  }

  async createChallenge(c: Omit<ChallengeRecord, 'attempts' | 'consumedAt'>): Promise<void> {
    await this.prisma.otpChallenge.create({ data: c });
  }

  findChallenge(id: string): Promise<ChallengeRecord | null> {
    return this.prisma.otpChallenge.findUnique({ where: { id } });
  }

  async incrementAttempts(id: string): Promise<number> {
    const c = await this.prisma.otpChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return c.attempts;
  }

  async lastChallengeAt(phone: string): Promise<Date | null> {
    const c = await this.prisma.otpChallenge.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return c?.createdAt ?? null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    return u ? toUser(u) : null;
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    const s = await this.prisma.session.findUnique({
      where: { id },
      include: { device: { select: { deviceId: true, app: true } }, user: { select: userSelect } },
    });
    if (!s) return null;
    return {
      id: s.id,
      userId: s.userId,
      deviceInstallId: s.device.deviceId,
      app: s.device.app,
      refreshHash: s.refreshHash,
      prevRefreshHash: s.prevRefreshHash,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      user: toUser(s.user),
    };
  }

  async rotateSession(id: string, expectedHash: string, newHash: string, expiresAt: Date, now: Date): Promise<boolean> {
    const { count } = await this.prisma.session.updateMany({
      where: { id, refreshHash: expectedHash, revokedAt: null },
      data: { prevRefreshHash: expectedHash, refreshHash: newHash, expiresAt, lastRefreshedAt: now },
    });
    return count === 1;
  }

  async revokeSession(id: string, reason: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }
}
