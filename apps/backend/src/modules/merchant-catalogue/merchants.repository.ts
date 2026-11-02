import { Injectable } from '@nestjs/common';
import { Prisma, type Merchant } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../common/geo/polygon';
import type { WeeklyHours } from '../../common/hours';
import { appendAudit, type AuditEntry } from '../../infra/audit/audit';
import type { FakeSinks } from '../../infra/fake/fake-sinks';
import { MemoryStore } from '../../infra/fake/memory-tx';
import type { NewEvent } from '../../infra/outbox/domain-event';
import { appendToOutbox } from '../../infra/outbox/outbox.writer';
import { point } from '../../infra/prisma/geo';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import type { MerchantRecord, MerchantStatus, StaffRecord } from './domain/merchant';

export type NewMerchant = Pick<MerchantRecord, 'ownerUserId' | 'type' | 'sellsFood' | 'category' | 'name'>;
export type MerchantPatch = Partial<Omit<MerchantRecord, 'id' | 'ownerUserId' | 'createdAt' | 'updatedAt'>>;

export interface MerchantQuery {
  status?: MerchantStatus | undefined;
  microMarketId?: string | undefined;
  limit: number;
}

export interface MerchantTx {
  /** Row-locks the merchant for the rest of the transaction. */
  lock(id: string): Promise<MerchantRecord | null>;
  create(m: NewMerchant): Promise<MerchantRecord>;
  update(id: string, patch: MerchantPatch): Promise<MerchantRecord>;
  addStaff(s: Pick<StaffRecord, 'merchantId' | 'name' | 'phone'>): Promise<StaffRecord>;
  removeStaff(merchantId: string, staffId: string): Promise<boolean>;
  appendEvent<P>(e: NewEvent<P>): Promise<void>;
  appendAudit(a: AuditEntry): Promise<void>;
}

/** Storage port for merchants and staff (merchant-catalogue owns these tables). */
export abstract class MerchantRepository {
  abstract transaction<T>(fn: (tx: MerchantTx) => Promise<T>): Promise<T>;
  abstract get(id: string): Promise<MerchantRecord | null>;
  abstract findByOwner(ownerUserId: string): Promise<MerchantRecord | null>;
  /** Oldest submission first (review queue order), then by name. */
  abstract list(q: MerchantQuery): Promise<MerchantRecord[]>;
  abstract staff(merchantId: string): Promise<StaffRecord[]>;
}

// ── Prisma ──

type Row = Merchant & { lat: number | null; lng: number | null };

const SELECT = Prisma.sql`m.id::text, m.owner_user_id::text, m.micro_market_id::text, m.type::text, m.sells_food, m.category,
  m.name, m.name_te, m.description, m.address_line, m.landmark, m.pincode, m.radius_m, m.hours, m.mov_paise, m.packaging_fee_paise,
  m.default_fulfilment::text, m.return_policy, m.hygiene_declared_at, m.status::text, m.submitted_at, m.decided_at,
  m.decided_by::text, m.rejection_code, m.rejection_note, m.live_at, m.accepting_orders, m.paused_reason, m.paused_at, m.missed_in_a_row, m.photo_ids::text[] AS photo_ids, m.created_at, m.updated_at,
  ST_Y(m.location::geometry) AS lat, ST_X(m.location::geometry) AS lng`;

const toRecord = (r: Row): MerchantRecord => ({
  id: r.id,
  ownerUserId: r.ownerUserId,
  microMarketId: r.microMarketId,
  type: r.type,
  sellsFood: r.sellsFood,
  category: r.category,
  name: r.name,
  nameTe: r.nameTe,
  description: r.description,
  addressLine: r.addressLine,
  landmark: r.landmark,
  pincode: r.pincode,
  location: r.lat == null || r.lng == null ? null : { lat: r.lat, lng: r.lng },
  radiusM: r.radiusM,
  hours: (r.hours as WeeklyHours | null) ?? null,
  movPaise: r.movPaise,
  packagingFeePaise: r.packagingFeePaise,
  defaultFulfilment: r.defaultFulfilment,
  returnPolicy: r.returnPolicy,
  hygieneDeclaredAt: r.hygieneDeclaredAt,
  status: r.status,
  submittedAt: r.submittedAt,
  decidedAt: r.decidedAt,
  decidedBy: r.decidedBy,
  rejectionCode: r.rejectionCode,
  rejectionNote: r.rejectionNote,
  liveAt: r.liveAt,
  acceptingOrders: r.acceptingOrders,
  pausedReason: r.pausedReason,
  pausedAt: r.pausedAt,
  missedInARow: r.missedInARow,
  photoIds: r.photoIds,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Raw rows come back snake_case; map to the Prisma field names toRecord expects. */
interface RawRow {
  id: string;
  owner_user_id: string;
  micro_market_id: string | null;
  type: Merchant['type'];
  sells_food: boolean;
  category: string | null;
  name: string;
  name_te: string | null;
  description: string | null;
  address_line: string | null;
  landmark: string | null;
  pincode: string | null;
  radius_m: number;
  hours: Prisma.JsonValue;
  mov_paise: number;
  packaging_fee_paise: number;
  default_fulfilment: Merchant['defaultFulfilment'];
  return_policy: string | null;
  hygiene_declared_at: Date | null;
  status: MerchantStatus;
  submitted_at: Date | null;
  decided_at: Date | null;
  decided_by: string | null;
  rejection_code: string | null;
  rejection_note: string | null;
  live_at: Date | null;
  accepting_orders: boolean;
  paused_reason: string | null;
  paused_at: Date | null;
  missed_in_a_row: number;
  photo_ids: string[];
  created_at: Date;
  updated_at: Date;
  lat: number | null;
  lng: number | null;
}

const fromRaw = (r: RawRow): MerchantRecord =>
  toRecord({
    id: r.id,
    ownerUserId: r.owner_user_id,
    microMarketId: r.micro_market_id,
    type: r.type,
    sellsFood: r.sells_food,
    category: r.category,
    name: r.name,
    nameTe: r.name_te,
    description: r.description,
    addressLine: r.address_line,
    landmark: r.landmark,
    pincode: r.pincode,
    radiusM: r.radius_m,
    hours: r.hours,
    movPaise: r.mov_paise,
    packagingFeePaise: r.packaging_fee_paise,
    defaultFulfilment: r.default_fulfilment,
    returnPolicy: r.return_policy,
    hygieneDeclaredAt: r.hygiene_declared_at,
    status: r.status,
    submittedAt: r.submitted_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    rejectionCode: r.rejection_code,
    rejectionNote: r.rejection_note,
    liveAt: r.live_at,
    acceptingOrders: r.accepting_orders,
    pausedReason: r.paused_reason,
    pausedAt: r.paused_at,
    missedInARow: r.missed_in_a_row,
    photoIds: r.photo_ids ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lat: r.lat,
    lng: r.lng,
  } as Row);

async function selectOne(db: PrismaService | Tx, where: Prisma.Sql, lock = false): Promise<MerchantRecord | null> {
  const rows = await db.$queryRaw<RawRow[]>`SELECT ${SELECT} FROM merchants m WHERE ${where} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  return rows[0] ? fromRaw(rows[0]) : null;
}

class PrismaMerchantTx implements MerchantTx {
  constructor(private readonly tx: Tx) {}

  lock(id: string) {
    return selectOne(this.tx, Prisma.sql`m.id = ${id}::uuid`, true);
  }

  async create(m: NewMerchant): Promise<MerchantRecord> {
    const r = await this.tx.merchant.create({ data: m });
    return (await selectOne(this.tx, Prisma.sql`m.id = ${r.id}::uuid`))!;
  }

  async update(id: string, patch: MerchantPatch): Promise<MerchantRecord> {
    const { location, hours, ...rest } = patch;
    const data: Prisma.MerchantUpdateInput = { ...rest };
    if (hours !== undefined) data.hours = hours === null ? Prisma.JsonNull : (hours as Prisma.InputJsonValue);
    await this.tx.merchant.update({ where: { id }, data });
    if (location !== undefined)
      await this.tx.$executeRaw`UPDATE merchants SET location = ${location ? point(location) : null} WHERE id = ${id}::uuid`;
    return (await selectOne(this.tx, Prisma.sql`m.id = ${id}::uuid`))!;
  }

  addStaff(s: Pick<StaffRecord, 'merchantId' | 'name' | 'phone'>): Promise<StaffRecord> {
    return this.tx.merchantStaff.create({ data: s });
  }

  async removeStaff(merchantId: string, staffId: string): Promise<boolean> {
    const { count } = await this.tx.merchantStaff.deleteMany({ where: { id: staffId, merchantId } });
    return count === 1;
  }

  async appendEvent<P>(e: NewEvent<P>): Promise<void> {
    await appendToOutbox(this.tx, e);
  }

  async appendAudit(a: AuditEntry): Promise<void> {
    await appendAudit(this.tx, a);
  }
}

@Injectable()
export class PrismaMerchantRepository extends MerchantRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  transaction<T>(fn: (tx: MerchantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaMerchantTx(tx)));
  }

  get(id: string) {
    return selectOne(this.prisma, Prisma.sql`m.id = ${id}::uuid`);
  }

  findByOwner(ownerUserId: string) {
    return selectOne(this.prisma, Prisma.sql`m.owner_user_id = ${ownerUserId}::uuid`);
  }

  async list(q: MerchantQuery): Promise<MerchantRecord[]> {
    const conds = [
      q.status ? Prisma.sql`m.status = ${q.status}::"MerchantStatus"` : null,
      q.microMarketId ? Prisma.sql`m.micro_market_id = ${q.microMarketId}::uuid` : null,
    ].filter((c): c is Prisma.Sql => c !== null);
    const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT ${SELECT} FROM merchants m ${where}
      ORDER BY m.submitted_at ASC NULLS LAST, m.name ASC LIMIT ${q.limit}`;
    return rows.map(fromRaw);
  }

  staff(merchantId: string): Promise<StaffRecord[]> {
    return this.prisma.merchantStaff.findMany({ where: { merchantId }, orderBy: { createdAt: 'asc' } });
  }
}

// ── in-memory (fake mode + tests) ──

interface MemState {
  merchants: MerchantRecord[];
  staff: StaffRecord[];
}

export class InMemoryMerchantRepository extends MerchantRepository {
  private readonly store: MerchantStore;

  constructor(sinks?: FakeSinks) {
    super();
    this.store = new MerchantStore(sinks);
  }

  transaction<T>(fn: (tx: MerchantTx) => Promise<T>): Promise<T> {
    return this.store.tx(fn);
  }

  async get(id: string) {
    return this.store.read((s) => s.merchants.find((m) => m.id === id) ?? null);
  }

  async findByOwner(ownerUserId: string) {
    return this.store.read((s) => s.merchants.find((m) => m.ownerUserId === ownerUserId) ?? null);
  }

  async list(q: MerchantQuery): Promise<MerchantRecord[]> {
    return this.store.read((s) =>
      s.merchants
        .filter((m) => (!q.status || m.status === q.status) && (!q.microMarketId || m.microMarketId === q.microMarketId))
        .sort(
          (a, b) =>
            (a.submittedAt?.getTime() ?? Infinity) - (b.submittedAt?.getTime() ?? Infinity) || a.name.localeCompare(b.name),
        )
        .slice(0, q.limit),
    );
  }

  async staff(merchantId: string): Promise<StaffRecord[]> {
    return this.store.read((s) => s.staff.filter((x) => x.merchantId === merchantId));
  }

  /** Loads demo rows directly (no events or audit) — fake-mode boot only. */
  seed(merchants: MerchantRecord[], staff: StaffRecord[]): void {
    this.store.load(merchants, staff);
  }
}

class MerchantStore extends MemoryStore<MemState> {
  constructor(sinks?: FakeSinks) {
    super({ merchants: [], staff: [] }, sinks);
  }

  read<T>(fn: (s: MemState) => T): T {
    return this.clone(fn(this.state));
  }

  load(merchants: MerchantRecord[], staff: StaffRecord[]): void {
    this.state.merchants.push(...this.clone(merchants));
    this.state.staff.push(...this.clone(staff));
  }

  tx<T>(fn: (tx: MerchantTx) => Promise<T>): Promise<T> {
    return this.runTx((fx) =>
      fn({
        lock: async (id) => this.clone(this.state.merchants.find((m) => m.id === id) ?? null),
        create: async (m) => {
          if (this.state.merchants.some((x) => x.ownerUserId === m.ownerUserId)) throw new Error('unique: owner_user_id');
          const now = new Date();
          const rec: MerchantRecord = {
            ...m,
            id: randomUUID(),
            microMarketId: null,
            nameTe: null,
            description: null,
            addressLine: null,
            landmark: null,
            pincode: null,
            location: null,
            radiusM: 3000,
            hours: null,
            movPaise: 0,
            packagingFeePaise: 0,
            defaultFulfilment: 'rider',
            returnPolicy: null,
            hygieneDeclaredAt: null,
            status: 'draft',
            submittedAt: null,
            decidedAt: null,
            decidedBy: null,
            rejectionCode: null,
            rejectionNote: null,
            liveAt: null,
            acceptingOrders: true,
            pausedReason: null,
            pausedAt: null,
            missedInARow: 0,
            photoIds: [],
            createdAt: now,
            updatedAt: now,
          };
          this.state.merchants.push(rec);
          return this.clone(rec);
        },
        update: async (id, patch) => {
          const m = this.state.merchants.find((x) => x.id === id);
          if (!m) throw new Error(`merchant ${id} not found`);
          Object.assign(m, this.clone(patch), { updatedAt: new Date() });
          return this.clone(m);
        },
        addStaff: async (s) => {
          if (this.state.staff.some((x) => x.merchantId === s.merchantId && x.phone === s.phone))
            throw new Error('unique: merchant_staff');
          const rec: StaffRecord = { ...s, id: randomUUID(), active: true, createdAt: new Date() };
          this.state.staff.push(rec);
          return this.clone(rec);
        },
        removeStaff: async (merchantId, staffId) => {
          const before = this.state.staff.length;
          this.state.staff = this.state.staff.filter((x) => !(x.id === staffId && x.merchantId === merchantId));
          return this.state.staff.length < before;
        },
        appendEvent: async (e) => fx.event(e),
        appendAudit: async (a) => fx.audit(a),
      }),
    );
  }
}

/** Upper bound for a single list page in ops tables. */
export const MAX_LIST = 200;
export type { LatLng };
