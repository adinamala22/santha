import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import type { SeedPerson } from '../../dev/seed-data';
import { buildEvent, type DomainEvent, type NewEvent } from '../../infra/outbox/domain-event';
import {
  ChallengeRecord,
  DeviceInput,
  IdentityRepository,
  IdentityTx,
  SessionRecord,
  UserRecord,
} from './identity.repository';

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

export interface InMemoryIdentityOptions {
  /** Called once per event after its transaction commits (the in-memory stand-in for the outbox). */
  onEvent?: (event: DomainEvent) => void;
}

/**
 * In-memory IdentityRepository. Used by unit/e2e tests and by the local fake mode
 * (`DATA_STORE=memory`). Transactions run one at a time and are emulated by snapshotting state
 * and restoring it when the callback throws, so rollback semantics match Postgres. Data is lost
 * on restart.
 */
export class InMemoryIdentityRepository extends IdentityRepository {
  users = new Map<string, UserRecord>();
  challenges = new Map<string, ChallengeRecord>();
  devices = new Map<string, DeviceInput & { id: string; lastSeenAt: Date }>();
  sessions = new Map<string, StoredSession>();
  /** Every committed event, oldest first. */
  events: DomainEvent[] = [];

  /** Mirrors the DB default `created_at = now()`; tests can swap the clock. */
  clock: () => Date = () => new Date();
  private readonly createdAt = new Map<string, Date>();
  private txLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: InMemoryIdentityOptions = {}) {
    super();
  }

  /** Loads demo users (same list as the Postgres seed). Idempotent. */
  seed(people: readonly SeedPerson[]): void {
    for (const p of people) {
      const existing = [...this.users.values()].find((u) => u.phone === p.phone);
      if (existing) {
        existing.name = p.name;
        for (const r of p.roles) if (!existing.roles.includes(r)) existing.roles.push(r);
        continue;
      }
      const id = randomUUID();
      this.users.set(id, { id, phone: p.phone, name: p.name, locale: 'en', status: 'active', roles: [...p.roles] });
    }
  }

  transaction<T>(fn: (tx: IdentityTx) => Promise<T>): Promise<T> {
    const run = this.txLock.then(() => this.runTransaction(fn));
    this.txLock = run.catch(() => undefined);
    return run;
  }

  private async runTransaction<T>(fn: (tx: IdentityTx) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({
      users: [...this.users],
      challenges: [...this.challenges],
      devices: [...this.devices],
      sessions: [...this.sessions],
    });
    const pending: DomainEvent[] = [];
    let result: T;
    try {
      result = await fn(this.txApi(pending));
    } catch (err) {
      this.users = new Map(snapshot.users);
      this.challenges = new Map(snapshot.challenges);
      this.devices = new Map(snapshot.devices);
      this.sessions = new Map(snapshot.sessions);
      throw err;
    }
    this.events.push(...pending);
    for (const e of pending) this.options.onEvent?.(e);
    return result;
  }

  private txApi(pending: DomainEvent[]): IdentityTx {
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
      appendEvent: async <P>(event: NewEvent<P>) => {
        pending.push(buildEvent(event as NewEvent) as DomainEvent);
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
