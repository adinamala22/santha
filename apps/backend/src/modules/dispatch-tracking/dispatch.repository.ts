import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { FallbackStage, PayLine } from './domain/dispatch';

export type FulfilmentMode = 'self' | 'rider' | 'tpl';
export type FulfilmentState = 'searching' | 'assigned' | 'picked_up' | 'delivered' | 'failed' | 'cancelled';
export type OfferState = 'offered' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

export interface RiderRecord {
  userId: string;
  name: string;
  vehicle: string;
  zones: string[];
  online: boolean;
  rating: number | null;
  offersShown: number;
  offersAccepted: number;
  onlineSince: Date | null;
  onlineMinToday: number;
  /** weekly (default) | daily payouts (M7). */
  payoutCadence: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export interface FulfilmentRecord {
  id: string;
  orderId: string;
  merchantId: string;
  microMarketId: string;
  mode: FulfilmentMode;
  state: FulfilmentState;
  staffId: string | null;
  staffToken: string | null;
  riderUserId: string | null;
  tplRef: string | null;
  pickupCode: string;
  deliveryOtp: string;
  fallbackStage: FallbackStage;
  selfBonusPaise: number;
  storeToDropM: number;
  riderPayPaise: number;
  payLines: PayLine[];
  batchedWith: string | null;
  promisedAt: Date;
  etaAt: Date | null;
  delayNotifiedAt: Date | null;
  proof: 'otp' | 'photo' | null;
  proofMediaId: string | null;
  codCollectedPaise: number | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  requestedAt: Date;
  assignedAt: Date | null;
  arrivedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  updatedAt: Date;
}

export interface OfferRecord {
  id: string;
  fulfilmentId: string;
  riderUserId: string;
  state: OfferState;
  payPaise: number;
  payLines: PayLine[];
  distanceM: number;
  offeredAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
}

export type FulfilmentPatch = Partial<
  Omit<FulfilmentRecord, 'id' | 'orderId' | 'merchantId' | 'microMarketId' | 'requestedAt' | 'updatedAt'>
>;
export const ACTIVE_STATES: readonly FulfilmentState[] = ['searching', 'assigned', 'picked_up'];

/** Storage port for dispatch-tracking: rider profiles, fulfilments and offers. */
export abstract class DispatchRepository {
  abstract getRider(userId: string): Promise<RiderRecord | null>;
  abstract upsertRider(r: Pick<RiderRecord, 'userId' | 'name'> & Partial<RiderRecord>): Promise<RiderRecord>;
  abstract updateRider(
    userId: string,
    patch: Partial<Omit<RiderRecord, 'userId' | 'createdAt'>>,
  ): Promise<RiderRecord | null>;
  abstract riders(filter?: { online?: boolean }): Promise<RiderRecord[]>;
  abstract countOffer(userId: string, accepted: boolean): Promise<void>;

  abstract createFulfilment(f: Omit<FulfilmentRecord, 'updatedAt'>): Promise<FulfilmentRecord>;
  abstract fulfilment(id: string): Promise<FulfilmentRecord | null>;
  abstract fulfilmentForOrder(orderId: string): Promise<FulfilmentRecord | null>;
  abstract fulfilmentByToken(token: string): Promise<FulfilmentRecord | null>;
  /** Compare-and-swap on state (null = any): returns the updated row, or null if the state moved. */
  abstract updateFulfilment(
    id: string,
    expected: FulfilmentState | readonly FulfilmentState[] | null,
    patch: FulfilmentPatch,
  ): Promise<FulfilmentRecord | null>;
  abstract activeFulfilments(filter?: {
    riderUserId?: string;
    microMarketId?: string;
    merchantId?: string;
  }): Promise<FulfilmentRecord[]>;
  abstract deliveredForMerchant(merchantId: string, since: Date): Promise<FulfilmentRecord[]>;
  abstract deliveredForRider(riderUserId: string, since: Date): Promise<FulfilmentRecord[]>;

  abstract createOffer(o: OfferRecord): Promise<OfferRecord>;
  abstract offer(id: string): Promise<OfferRecord | null>;
  abstract updateOffer(
    id: string,
    expected: OfferState,
    patch: Partial<Pick<OfferRecord, 'state' | 'respondedAt'>>,
  ): Promise<OfferRecord | null>;
  abstract offersFor(fulfilmentId: string): Promise<OfferRecord[]>;
  abstract openOffersForRider(riderUserId: string): Promise<OfferRecord[]>;

  /** Ops overrides (reassign, force self-delivery) are audited. */
  abstract appendAudit(a: AuditEntry): Promise<void>;
}

const asStates = (e: FulfilmentState | readonly FulfilmentState[]) => (typeof e === 'string' ? [e] : [...e]);

const toFulfilment = (r: Prisma.FulfilmentGetPayload<object>): FulfilmentRecord => ({
  ...r,
  mode: r.mode as FulfilmentMode,
  state: r.state as FulfilmentState,
  fallbackStage: r.fallbackStage as FallbackStage,
  payLines: r.payLines as unknown as PayLine[],
  proof: r.proof as 'otp' | 'photo' | null,
});
const toOffer = (r: Prisma.DispatchOfferGetPayload<object>): OfferRecord => ({
  ...r,
  state: r.state as OfferState,
  payLines: r.payLines as unknown as PayLine[],
});

@Injectable()
export class PrismaDispatchRepository extends DispatchRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  getRider(userId: string) {
    return this.prisma.rider.findUnique({ where: { userId } });
  }

  upsertRider(r: Pick<RiderRecord, 'userId' | 'name'> & Partial<RiderRecord>) {
    const { userId, ...rest } = r;
    return this.prisma.rider.upsert({
      where: { userId },
      create: { userId, ...rest },
      update: { name: rest.name },
    });
  }

  async updateRider(userId: string, patch: Partial<Omit<RiderRecord, 'userId' | 'createdAt'>>) {
    const n = await this.prisma.rider.updateMany({ where: { userId }, data: patch });
    return n.count ? this.getRider(userId) : null;
  }

  riders(filter: { online?: boolean } = {}) {
    return this.prisma.rider.findMany({
      where: filter.online === undefined ? {} : { online: filter.online },
      orderBy: { name: 'asc' },
    });
  }

  async countOffer(userId: string, accepted: boolean) {
    await this.prisma.rider.updateMany({
      where: { userId },
      data: accepted ? { offersAccepted: { increment: 1 } } : { offersShown: { increment: 1 } },
    });
  }

  async createFulfilment(f: Omit<FulfilmentRecord, 'updatedAt'>) {
    return toFulfilment(
      await this.prisma.fulfilment.create({
        data: { ...f, payLines: f.payLines as unknown as Prisma.InputJsonValue },
      }),
    );
  }

  async fulfilment(id: string) {
    const r = await this.prisma.fulfilment.findUnique({ where: { id } });
    return r && toFulfilment(r);
  }

  async fulfilmentForOrder(orderId: string) {
    const r = await this.prisma.fulfilment.findUnique({ where: { orderId } });
    return r && toFulfilment(r);
  }

  async fulfilmentByToken(token: string) {
    const r = await this.prisma.fulfilment.findUnique({ where: { staffToken: token } });
    return r && toFulfilment(r);
  }

  async updateFulfilment(
    id: string,
    expected: FulfilmentState | readonly FulfilmentState[] | null,
    patch: FulfilmentPatch,
  ) {
    const { payLines, ...rest } = patch;
    const n = await this.prisma.fulfilment.updateMany({
      where: { id, ...(expected === null ? {} : { state: { in: asStates(expected) } }) },
      data: {
        ...rest,
        ...(payLines ? { payLines: payLines as unknown as Prisma.InputJsonValue } : {}),
        updatedAt: new Date(),
      },
    });
    return n.count ? this.fulfilment(id) : null;
  }

  async activeFulfilments(
    filter: { riderUserId?: string; microMarketId?: string; merchantId?: string } = {},
  ) {
    const rows = await this.prisma.fulfilment.findMany({
      where: { state: { in: [...ACTIVE_STATES] }, ...filter },
      orderBy: { requestedAt: 'asc' },
    });
    return rows.map(toFulfilment);
  }

  async deliveredForMerchant(merchantId: string, since: Date) {
    return (
      await this.prisma.fulfilment.findMany({
        where: { merchantId, state: 'delivered', deliveredAt: { gte: since } },
        orderBy: { deliveredAt: 'asc' },
      })
    ).map(toFulfilment);
  }

  async deliveredForRider(riderUserId: string, since: Date) {
    return (
      await this.prisma.fulfilment.findMany({
        where: { riderUserId, state: 'delivered', deliveredAt: { gte: since } },
        orderBy: { deliveredAt: 'asc' },
      })
    ).map(toFulfilment);
  }

  async createOffer(o: OfferRecord) {
    return toOffer(
      await this.prisma.dispatchOffer.create({
        data: { ...o, payLines: o.payLines as unknown as Prisma.InputJsonValue },
      }),
    );
  }

  async offer(id: string) {
    const r = await this.prisma.dispatchOffer.findUnique({ where: { id } });
    return r && toOffer(r);
  }

  async updateOffer(
    id: string,
    expected: OfferState,
    patch: Partial<Pick<OfferRecord, 'state' | 'respondedAt'>>,
  ) {
    const n = await this.prisma.dispatchOffer.updateMany({ where: { id, state: expected }, data: patch });
    return n.count ? this.offer(id) : null;
  }

  async offersFor(fulfilmentId: string) {
    return (
      await this.prisma.dispatchOffer.findMany({ where: { fulfilmentId }, orderBy: { offeredAt: 'asc' } })
    ).map(toOffer);
  }

  async appendAudit(a: AuditEntry) {
    await appendAudit(this.prisma, a);
  }

  async openOffersForRider(riderUserId: string) {
    return (
      await this.prisma.dispatchOffer.findMany({
        where: { riderUserId, state: 'offered' },
        orderBy: { offeredAt: 'asc' },
      })
    ).map(toOffer);
  }
}

/** Fake mode + tests. Single-threaded JS makes each synchronous check-and-set atomic. */
export class InMemoryDispatchRepository extends DispatchRepository {
  constructor(private readonly sinks?: FakeSinks) {
    super();
  }

  /** Fake mode: starts with the demo riders (offline). */
  static seeded(sinks: FakeSinks, riders: Array<Pick<RiderRecord, 'userId' | 'name' | 'vehicle' | 'rating'>>): InMemoryDispatchRepository {
    const repo = new InMemoryDispatchRepository(sinks);
    for (const x of riders) void repo.upsertRider(x);
    return repo;
  }

  async appendAudit(a: AuditEntry) {
    this.sinks?.record([{ ...a, id: randomUUID(), createdAt: new Date() }]);
  }

  private readonly riderRows = new Map<string, RiderRecord>();
  private readonly fulfilments = new Map<string, FulfilmentRecord>();
  private readonly offers = new Map<string, OfferRecord>();

  async getRider(userId: string) {
    const r = this.riderRows.get(userId);
    return r ? structuredClone(r) : null;
  }

  async upsertRider(r: Pick<RiderRecord, 'userId' | 'name'> & Partial<RiderRecord>) {
    const cur = this.riderRows.get(r.userId);
    const next: RiderRecord = cur
      ? { ...cur, name: r.name }
      : {
          vehicle: 'bike',
          payoutCadence: 'weekly',
          zones: [],
          online: false,
          rating: null,
          offersShown: 0,
          offersAccepted: 0,
          onlineSince: null,
          onlineMinToday: 0,
          lastSeenAt: null,
          createdAt: new Date(),
          ...r,
        };
    this.riderRows.set(r.userId, next);
    return structuredClone(next);
  }

  async updateRider(userId: string, patch: Partial<Omit<RiderRecord, 'userId' | 'createdAt'>>) {
    const cur = this.riderRows.get(userId);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.riderRows.set(userId, next);
    return structuredClone(next);
  }

  async riders(filter: { online?: boolean } = {}) {
    return structuredClone(
      [...this.riderRows.values()]
        .filter((r) => filter.online === undefined || r.online === filter.online)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async countOffer(userId: string, accepted: boolean) {
    const r = this.riderRows.get(userId);
    if (!r) return;
    if (accepted) r.offersAccepted += 1;
    else r.offersShown += 1;
  }

  async createFulfilment(f: Omit<FulfilmentRecord, 'updatedAt'>) {
    if ([...this.fulfilments.values()].some((x) => x.orderId === f.orderId))
      throw new Error('fulfilment exists for order');
    if (f.staffToken && [...this.fulfilments.values()].some((x) => x.staffToken === f.staffToken))
      throw new Error('staff token exists');
    const rec = { ...structuredClone(f), updatedAt: new Date() };
    this.fulfilments.set(f.id, rec);
    return structuredClone(rec);
  }

  async fulfilment(id: string) {
    const r = this.fulfilments.get(id);
    return r ? structuredClone(r) : null;
  }

  async fulfilmentForOrder(orderId: string) {
    const r = [...this.fulfilments.values()].find((x) => x.orderId === orderId);
    return r ? structuredClone(r) : null;
  }

  async fulfilmentByToken(token: string) {
    const r = [...this.fulfilments.values()].find((x) => x.staffToken === token);
    return r ? structuredClone(r) : null;
  }

  async updateFulfilment(
    id: string,
    expected: FulfilmentState | readonly FulfilmentState[] | null,
    patch: FulfilmentPatch,
  ) {
    const cur = this.fulfilments.get(id);
    if (!cur || (expected !== null && !asStates(expected).includes(cur.state))) return null;
    const next = { ...cur, ...structuredClone(patch), updatedAt: new Date() };
    this.fulfilments.set(id, next);
    return structuredClone(next);
  }

  async activeFulfilments(
    filter: { riderUserId?: string; microMarketId?: string; merchantId?: string } = {},
  ) {
    return structuredClone(
      [...this.fulfilments.values()]
        .filter(
          (f) =>
            ACTIVE_STATES.includes(f.state) &&
            (!filter.riderUserId || f.riderUserId === filter.riderUserId) &&
            (!filter.microMarketId || f.microMarketId === filter.microMarketId) &&
            (!filter.merchantId || f.merchantId === filter.merchantId),
        )
        .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()),
    );
  }

  private delivered(pred: (f: FulfilmentRecord) => boolean, since: Date) {
    return structuredClone(
      [...this.fulfilments.values()]
        .filter((f) => f.state === 'delivered' && f.deliveredAt && f.deliveredAt >= since && pred(f))
        .sort((a, b) => a.deliveredAt!.getTime() - b.deliveredAt!.getTime()),
    );
  }

  async deliveredForMerchant(merchantId: string, since: Date) {
    return this.delivered((f) => f.merchantId === merchantId, since);
  }

  async deliveredForRider(riderUserId: string, since: Date) {
    return this.delivered((f) => f.riderUserId === riderUserId, since);
  }

  async createOffer(o: OfferRecord) {
    this.offers.set(o.id, structuredClone(o));
    return structuredClone(o);
  }

  async offer(id: string) {
    const r = this.offers.get(id);
    return r ? structuredClone(r) : null;
  }

  async updateOffer(
    id: string,
    expected: OfferState,
    patch: Partial<Pick<OfferRecord, 'state' | 'respondedAt'>>,
  ) {
    const cur = this.offers.get(id);
    if (!cur || cur.state !== expected) return null;
    const next = { ...cur, ...patch };
    this.offers.set(id, next);
    return structuredClone(next);
  }

  async offersFor(fulfilmentId: string) {
    return structuredClone(
      [...this.offers.values()]
        .filter((o) => o.fulfilmentId === fulfilmentId)
        .sort((a, b) => a.offeredAt.getTime() - b.offeredAt.getTime()),
    );
  }

  async openOffersForRider(riderUserId: string) {
    return structuredClone(
      [...this.offers.values()]
        .filter((o) => o.riderUserId === riderUserId && o.state === 'offered')
        .sort((a, b) => a.offeredAt.getTime() - b.offeredAt.getTime()),
    );
  }
}
