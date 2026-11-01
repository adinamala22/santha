import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import type { NewEvent } from '../../src/infra/outbox/domain-event';
import {
  ChallengeRecord,
  DeviceInput,
  IdentityRepository,
  IdentityTx,
  SessionRecord,
  UserRecord,
} from '../../src/modules/identity-kyc/identity.repository';
import { RateLimiter, RateLimitResult } from '../../src/modules/identity-kyc/rate-limiter';

interface StoredSession {
  id: string;
  userId: string;
  deviceRowId: string;
  refreshHash: string;
  prevRefreshHash: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason?: string;
}

/**
 * In-memory IdentityRepository for unit/e2e tests. Transactions are emulated by snapshotting
 * state and restoring it when the callback throws, so rollback semantics match Postgres.
 */
export class InMemoryIdentityRepository extends IdentityRepository {
  users = new Map<string, UserRecord>();
  challenges = new Map<string, ChallengeRecord>();
  devices = new Map<string, DeviceInput & { id: string; lastSeenAt: Date }>();
  sessions = new Map<string, StoredSession>();
  events: NewEvent[] = [];

  async transaction<T>(fn: (tx: IdentityTx) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({
      users: [...this.users],
      challenges: [...this.challenges],
      devices: [...this.devices],
      sessions: [...this.sessions],
      events: this.events,
    });
    try {
      return await fn(this.txApi());
    } catch (err) {
      this.users = new Map(snapshot.users);
      this.challenges = new Map(snapshot.challenges);
      this.devices = new Map(snapshot.devices);
      this.sessions = new Map(snapshot.sessions);
      this.events = snapshot.events;
      throw err;
    }
  }

  private txApi(): IdentityTx {
    return {
      consumeChallenge: async (id, now) => {
        const c = this.challenges.get(id);
        if (!c || c.consumedAt) return false;
        c.consumedAt = now;
        return true;
      },
      findUserByPhone: async (phone) => {
        const u = [...this.users.values()].find((x) => x.phone === phone);
        return u ? structuredClone(u) : null;
      },
      createUser: async (phone) => {
        const u: UserRecord = { id: randomUUID(), phone, name: null, locale: 'en', status: 'active', roles: [] };
        this.users.set(u.id, u);
        return structuredClone(u);
      },
      grantRole: async (userId, role: Role) => {
        const u = this.users.get(userId)!;
        if (u.roles.includes(role)) return false;
        u.roles.push(role);
        return true;
      },
      upsertDevice: async (input, now) => {
        const existing = [...this.devices.values()].find(
          (d) => d.userId === input.userId && d.deviceId === input.deviceId && d.app === input.app,
        );
        if (existing) {
          Object.assign(existing, { platform: input.platform, appVersion: input.appVersion, lastSeenAt: now });
          return { id: existing.id };
        }
        const id = randomUUID();
        this.devices.set(id, { ...input, id, lastSeenAt: now });
        return { id };
      },
      createSession: async (input) => {
        this.sessions.set(input.id, { ...input, prevRefreshHash: null, revokedAt: null });
      },
      appendEvent: async (event) => {
        this.events.push(event as NewEvent);
      },
    };
  }

  async createChallenge(c: Omit<ChallengeRecord, 'attempts' | 'consumedAt'>): Promise<void> {
    this.challenges.set(c.id, { ...c, attempts: 0, consumedAt: null });
    this.createdAt.set(c.id, this.clock());
  }

  async findChallenge(id: string): Promise<ChallengeRecord | null> {
    const c = this.challenges.get(id);
    return c ? { ...c } : null;
  }

  async incrementAttempts(id: string): Promise<number> {
    const c = this.challenges.get(id)!;
    c.attempts += 1;
    return c.attempts;
  }

  async lastChallengeAt(phone: string): Promise<Date | null> {
    const times = [...this.challenges.values()]
      .filter((c) => c.phone === phone)
      .map((c) => this.createdAt.get(c.id)!.getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  }

  /** Mirrors the DB default `created_at = now()`; tests can swap the clock. */
  clock: () => Date = () => new Date();
  private readonly createdAt = new Map<string, Date>();

  async findUserById(id: string): Promise<UserRecord | null> {
    const u = this.users.get(id);
    return u ? structuredClone(u) : null;
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const d = this.devices.get(s.deviceRowId)!;
    return {
      id: s.id,
      userId: s.userId,
      deviceInstallId: d.deviceId,
      app: d.app,
      refreshHash: s.refreshHash,
      prevRefreshHash: s.prevRefreshHash,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      user: structuredClone(this.users.get(s.userId)!),
    };
  }

  async rotateSession(id: string, expectedHash: string, newHash: string, expiresAt: Date): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s || s.revokedAt || s.refreshHash !== expectedHash) return false;
    s.prevRefreshHash = expectedHash;
    s.refreshHash = newHash;
    s.expiresAt = expiresAt;
    return true;
  }

  async revokeSession(id: string, reason: string, now: Date): Promise<void> {
    const s = this.sessions.get(id);
    if (s && !s.revokedAt) {
      s.revokedAt = now;
      s.revokedReason = reason;
    }
  }
}

/** Counts hits per key; never resets unless `reset()` is called. */
export class InMemoryRateLimiter extends RateLimiter {
  counts = new Map<string, number>();

  async hit(key: string, limit: number): Promise<RateLimitResult> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return { allowed: n <= limit, retryAfterSec: n <= limit ? 0 : 3600 };
  }

  reset(): void {
    this.counts.clear();
  }
}
