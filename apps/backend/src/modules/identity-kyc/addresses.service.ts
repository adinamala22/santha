import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import type { LatLng } from '../../common/geo/polygon';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { type AddressLabel, type AddressPatch, type AddressRecord, AddressRepository } from './addresses.repository';

export const MAX_ADDRESSES = 10;

export interface AddressInput {
  label: AddressLabel;
  name?: string | null | undefined;
  line: string;
  landmark?: string | null | undefined;
  pincode?: string | null | undefined;
  location: LatLng;
  isDefault?: boolean | undefined;
  leaveAtDoor?: boolean | undefined;
}

export interface AddressView {
  address: AddressRecord;
  /** Serviceability of the pin right now (null = not in any micro-market yet). */
  microMarket: { id: string; slug: string; name: string; nameTe: string } | null;
}

/**
 * Saved addresses (PRD FR-LOC-1): up to 10 per consumer, labelled; each resolves to a micro-market
 * (or "not serviceable yet") from its pin. The first address becomes the default.
 */
@Injectable()
export class AddressesService {
  constructor(
    private readonly repo: AddressRepository,
    private readonly markets: MicroMarketsService,
  ) {}

  async list(userId: string): Promise<AddressView[]> {
    return Promise.all((await this.repo.list(userId)).map((a) => this.view(a)));
  }

  async create(userId: string, input: AddressInput): Promise<AddressView> {
    const hit = await this.markets.resolve(input.location);
    const created = await this.repo.transaction(async (tx) => {
      const existing = await tx.list(userId);
      if (existing.length >= MAX_ADDRESSES) throw new DomainError('VALIDATION_FAILED', `You can save up to ${MAX_ADDRESSES} addresses.`);
      const makeDefault = existing.length === 0 || !!input.isDefault;
      const a = await tx.create({
        userId,
        label: input.label,
        name: input.label === 'other' ? input.name?.trim() || null : null,
        line: input.line.trim(),
        landmark: input.landmark?.trim() || null,
        pincode: input.pincode?.trim() || null,
        location: input.location,
        microMarketId: hit?.market.id ?? null,
        isDefault: makeDefault,
        leaveAtDoor: !!input.leaveAtDoor,
      });
      if (makeDefault) await tx.setDefault(userId, a.id);
      return { ...a, isDefault: makeDefault };
    });
    return this.view(created);
  }

  async update(userId: string, id: string, input: Partial<AddressInput>): Promise<AddressView> {
    await this.owned(userId, id);
    const patch: AddressPatch = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.name !== undefined) patch.name = input.name?.trim() || null;
    if (input.line !== undefined) patch.line = input.line.trim();
    if (input.landmark !== undefined) patch.landmark = input.landmark?.trim() || null;
    if (input.pincode !== undefined) patch.pincode = input.pincode?.trim() || null;
    if (input.leaveAtDoor !== undefined) patch.leaveAtDoor = input.leaveAtDoor;
    if (input.location) {
      patch.location = input.location;
      patch.microMarketId = (await this.markets.resolve(input.location))?.market.id ?? null;
    }
    const updated = await this.repo.transaction(async (tx) => {
      const a = Object.keys(patch).length ? await tx.update(id, patch) : (await tx.list(userId)).find((x) => x.id === id)!;
      if (input.isDefault) {
        await tx.setDefault(userId, id);
        return { ...a, isDefault: true };
      }
      return a;
    });
    return this.view(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const a = await this.owned(userId, id);
    await this.repo.transaction(async (tx) => {
      await tx.remove(id);
      if (a.isDefault) {
        const next = (await tx.list(userId))[0];
        if (next) await tx.setDefault(userId, next.id);
      }
    });
  }

  private async owned(userId: string, id: string): Promise<AddressRecord> {
    const a = await this.repo.get(id);
    if (!a || a.userId !== userId) throw new DomainError('NOT_FOUND', 'Address not found');
    return a;
  }

  private async view(a: AddressRecord): Promise<AddressView> {
    const hit = await this.markets.resolve(a.location);
    return { address: a, microMarket: hit ? { id: hit.market.id, slug: hit.market.slug, name: hit.market.name, nameTe: hit.market.nameTe } : null };
  }
}
