import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../common/geo/polygon';
import { MemoryStore } from '../../infra/fake/memory-tx';
import { point } from '../../infra/prisma/geo';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';

export type AddressLabel = 'home' | 'work' | 'other';

export interface AddressRecord {
  id: string;
  userId: string;
  label: AddressLabel;
  name: string | null;
  line: string;
  landmark: string | null;
  pincode: string | null;
  location: LatLng;
  microMarketId: string | null;
  isDefault: boolean;
  /** Prepaid orders to this address may be left at the door (ADR-036). */
  leaveAtDoor: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAddress = Omit<AddressRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type AddressPatch = Partial<Omit<AddressRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

export interface AddressTx {
  list(userId: string): Promise<AddressRecord[]>;
  create(a: NewAddress): Promise<AddressRecord>;
  update(id: string, patch: AddressPatch): Promise<AddressRecord>;
  remove(id: string): Promise<void>;
  /** Makes `id` the only default address of the user. */
  setDefault(userId: string, id: string): Promise<void>;
}

/** Storage port for saved addresses (identity-kyc owns them). */
export abstract class AddressRepository {
  abstract transaction<T>(fn: (tx: AddressTx) => Promise<T>): Promise<T>;
  /** Default first, then newest first. */
  abstract list(userId: string): Promise<AddressRecord[]>;
  abstract get(id: string): Promise<AddressRecord | null>;
}

// ───────────── Prisma ─────────────

interface Row {
  id: string;
  user_id: string;
  label: AddressLabel;
  name: string | null;
  line: string;
  landmark: string | null;
  pincode: string | null;
  lat: number;
  lng: number;
  micro_market_id: string | null;
  is_default: boolean;
  leave_at_door: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLS = Prisma.sql`a.id::text, a.user_id::text, a.label, a.name, a.line, a.landmark, a.pincode,
  ST_Y(a.location::geometry) AS lat, ST_X(a.location::geometry) AS lng, a.micro_market_id::text, a.is_default, a.leave_at_door, a.created_at, a.updated_at`;

const toRecord = (r: Row): AddressRecord => ({
  id: r.id,
  userId: r.user_id,
  label: r.label,
  name: r.name,
  line: r.line,
  landmark: r.landmark,
  pincode: r.pincode,
  location: { lat: r.lat, lng: r.lng },
  microMarketId: r.micro_market_id,
  isDefault: r.is_default,
  leaveAtDoor: r.leave_at_door,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const ORDER = Prisma.sql`ORDER BY a.is_default DESC, a.created_at DESC, a.id`;

async function selectWhere(db: PrismaService | Tx, where: Prisma.Sql): Promise<AddressRecord[]> {
  const rows = await db.$queryRaw<Row[]>`SELECT ${COLS} FROM addresses a WHERE ${where} ${ORDER}`;
  return rows.map(toRecord);
}

class PrismaAddressTx implements AddressTx {
  constructor(private readonly tx: Tx) {}

  list(userId: string) {
    return selectWhere(this.tx, Prisma.sql`a.user_id = ${userId}::uuid`);
  }

  async create(a: NewAddress): Promise<AddressRecord> {
    const id = randomUUID();
    await this.tx.$executeRaw`
      INSERT INTO addresses (id, user_id, label, name, line, landmark, pincode, location, micro_market_id, is_default, leave_at_door, updated_at)
      VALUES (${id}::uuid, ${a.userId}::uuid, ${a.label}, ${a.name}, ${a.line}, ${a.landmark}, ${a.pincode}, ${point(a.location)},
        ${a.microMarketId}::uuid, ${a.isDefault}, ${a.leaveAtDoor}, now())`;
    return (await selectWhere(this.tx, Prisma.sql`a.id = ${id}::uuid`))[0]!;
  }

  async update(id: string, patch: AddressPatch): Promise<AddressRecord> {
    const { location, ...rest } = patch;
    if (Object.keys(rest).length) await this.tx.address.update({ where: { id }, data: rest });
    if (location) await this.tx.$executeRaw`UPDATE addresses SET location = ${point(location)}, updated_at = now() WHERE id = ${id}::uuid`;
    return (await selectWhere(this.tx, Prisma.sql`a.id = ${id}::uuid`))[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.tx.address.delete({ where: { id } });
  }

  async setDefault(userId: string, id: string): Promise<void> {
    await this.tx.$executeRaw`UPDATE addresses SET is_default = (id = ${id}::uuid) WHERE user_id = ${userId}::uuid`;
  }
}

@Injectable()
export class PrismaAddressRepository extends AddressRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  transaction<T>(fn: (tx: AddressTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaAddressTx(tx)));
  }

  list(userId: string) {
    return selectWhere(this.prisma, Prisma.sql`a.user_id = ${userId}::uuid`);
  }

  async get(id: string) {
    return (await selectWhere(this.prisma, Prisma.sql`a.id = ${id}::uuid`))[0] ?? null;
  }
}

// ───────────── in-memory (fake mode + tests) ─────────────

const sortAddresses = (a: AddressRecord, b: AddressRecord) =>
  Number(b.isDefault) - Number(a.isDefault) || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);

class AddressStore extends MemoryStore<{ rows: AddressRecord[] }> {
  constructor() {
    super({ rows: [] });
  }

  read<T>(fn: (rows: AddressRecord[]) => T): T {
    return this.clone(fn(this.state.rows));
  }

  load(rows: AddressRecord[]): void {
    this.state.rows.push(...this.clone(rows));
  }

  tx<T>(fn: (tx: AddressTx) => Promise<T>): Promise<T> {
    const find = (id: string) => {
      const r = this.state.rows.find((x) => x.id === id);
      if (!r) throw new Error(`address ${id} not found`);
      return r;
    };
    return this.runTx(() =>
      fn({
        list: async (userId) => this.clone(this.state.rows.filter((r) => r.userId === userId).sort(sortAddresses)),
        create: async (a) => {
          // Strictly increasing like Postgres' microsecond now(), so "newest first" never ties.
          const last = Math.max(0, ...this.state.rows.map((r) => r.createdAt.getTime()));
          const now = new Date(Math.max(Date.now(), last + 1));
          const rec: AddressRecord = { ...this.clone(a), id: randomUUID(), createdAt: now, updatedAt: now };
          this.state.rows.push(rec);
          return this.clone(rec);
        },
        update: async (id, patch) => {
          const r = find(id);
          Object.assign(r, this.clone(patch), { updatedAt: new Date() });
          return this.clone(r);
        },
        remove: async (id) => {
          find(id);
          this.state.rows = this.state.rows.filter((r) => r.id !== id);
        },
        setDefault: async (userId, id) => {
          for (const r of this.state.rows) if (r.userId === userId) r.isDefault = r.id === id;
        },
      }),
    );
  }
}

export class InMemoryAddressRepository extends AddressRepository {
  private readonly store = new AddressStore();

  transaction<T>(fn: (tx: AddressTx) => Promise<T>): Promise<T> {
    return this.store.tx(fn);
  }

  async list(userId: string) {
    return this.store.read((rows) => rows.filter((r) => r.userId === userId).sort(sortAddresses));
  }

  async get(id: string) {
    return this.store.read((rows) => rows.find((r) => r.id === id) ?? null);
  }

  /** Demo rows (fake-mode boot only). */
  seed(rows: AddressRecord[]): void {
    this.store.load(rows);
  }
}
