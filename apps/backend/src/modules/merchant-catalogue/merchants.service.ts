import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import type { LatLng } from '../../common/geo/polygon';
import type { WeeklyHours } from '../../common/hours';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { normalizeIndianMobile } from '../identity-kyc/domain/phone';
import { type KycCheckRecord, KycService } from '../identity-kyc/kyc.service';
import {
  checklist,
  type ChecklistItem,
  type FulfilmentMode,
  MAX_STAFF,
  type MerchantRecord,
  type MerchantType,
  missingSteps,
  needsFssai,
  profileEditable,
  type RejectionCode,
  type StaffRecord,
} from './domain/merchant';
import { MAX_LIST, MerchantRepository, type MerchantPatch, type MerchantQuery } from './merchants.repository';

export interface MerchantView {
  merchant: MerchantRecord;
  staff: StaffRecord[];
  kyc: KycCheckRecord[];
  checklist: ChecklistItem[];
  microMarket: { id: string; slug: string; name: string; nameTe: string } | null;
}

export interface CreateMerchantInput {
  type: MerchantType;
  name: string;
  sellsFood?: boolean | undefined;
  category?: string | null | undefined;
}

export interface UpdateMerchantInput {
  type?: MerchantType | undefined;
  sellsFood?: boolean | undefined;
  category?: string | null | undefined;
  name?: string | undefined;
  nameTe?: string | null | undefined;
  description?: string | null | undefined;
  location?: LatLng | undefined;
  addressLine?: string | undefined;
  landmark?: string | null | undefined;
  pincode?: string | undefined;
  returnPolicy?: string | null | undefined;
  hygieneDeclared?: boolean | undefined;
  hours?: WeeklyHours | undefined;
  radiusM?: number | undefined;
  movPaise?: number | undefined;
  defaultFulfilment?: FulfilmentMode | undefined;
}

export interface OpsActor {
  userId: string;
  requestId?: string | null;
}

/**
 * merchant-catalogue, merchant side (M1): self-onboarding by the owner and the ops review
 * pipeline draft → submitted → approved/rejected → live (FR-OPS-1). Catalogue arrives in M2.
 */
@Injectable()
export class MerchantsService {
  constructor(
    private readonly repo: MerchantRepository,
    private readonly kyc: KycService,
    private readonly markets: MicroMarketsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────── owner (merchant app) ─────────

  async create(ownerUserId: string, input: CreateMerchantInput): Promise<MerchantView> {
    if (await this.repo.findByOwner(ownerUserId))
      throw new DomainError('ALREADY_EXISTS', 'You already have a store. Continue setting it up.');
    const merchant = await this.repo.transaction(async (tx) => {
      const m = await tx.create({
        ownerUserId,
        type: input.type,
        name: input.name.trim(),
        sellsFood: input.type === 'home_kitchen' ? true : (input.sellsFood ?? false),
        category: input.type === 'retail' ? (input.category ?? null) : null,
      });
      await tx.appendEvent({
        type: 'merchant.created',
        aggregate: { type: 'merchant', id: m.id },
        actor: { type: 'user', id: ownerUserId },
        payload: { merchant_id: m.id, owner_user_id: ownerUserId, type: m.type, sells_food: m.sellsFood },
      });
      return m;
    });
    return this.view(merchant);
  }

  async mine(ownerUserId: string): Promise<MerchantView> {
    return this.view(await this.owned(ownerUserId));
  }

  async update(ownerUserId: string, input: UpdateMerchantInput): Promise<MerchantView> {
    const current = await this.owned(ownerUserId);
    const profileKeys = (
      ['type', 'sellsFood', 'category', 'name', 'nameTe', 'description', 'location', 'addressLine', 'landmark', 'pincode', 'returnPolicy', 'hygieneDeclared'] as const
    ).filter((k) => input[k] !== undefined);
    if (profileKeys.length && !profileEditable(current.status))
      throw new DomainError('INVALID_STATE', 'Store details are locked while under review or live. Contact Santha support to change them.', {
        fields: profileKeys,
      });

    const patch: MerchantPatch = {};
    const type = input.type ?? current.type;
    if (input.type !== undefined) patch.type = input.type;
    if (input.name !== undefined) patch.name = input.name.trim();
    for (const k of ['nameTe', 'description', 'landmark', 'returnPolicy'] as const)
      if (input[k] !== undefined) patch[k] = input[k]?.trim() || null;
    if (input.addressLine !== undefined) patch.addressLine = input.addressLine.trim();
    if (input.pincode !== undefined) patch.pincode = input.pincode;
    if (input.category !== undefined || input.type !== undefined)
      patch.category = type === 'retail' ? (input.category !== undefined ? input.category : current.category) : null;
    if (input.sellsFood !== undefined || input.type !== undefined)
      patch.sellsFood = type === 'home_kitchen' ? true : (input.sellsFood ?? current.sellsFood);
    if (input.hygieneDeclared !== undefined) patch.hygieneDeclaredAt = input.hygieneDeclared ? this.clock() : null;
    if (input.location) {
      const hit = await this.markets.resolve(input.location);
      patch.location = input.location;
      patch.microMarketId = hit?.market.id ?? null;
    }
    for (const k of ['hours', 'radiusM', 'movPaise', 'defaultFulfilment'] as const) if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];

    const merchant = await this.repo.transaction((tx) => tx.update(current.id, patch));
    return this.view(merchant);
  }

  /** KYC steps run through identity-kyc; allowed only while the profile is editable. */
  async runKyc<T extends unknown[]>(
    ownerUserId: string,
    step: (kyc: KycService, subject: { type: 'merchant'; id: string }, actor: { type: 'user'; id: string }, ...args: T) => Promise<KycCheckRecord>,
    ...args: T
  ): Promise<KycCheckRecord> {
    const m = await this.owned(ownerUserId);
    if (!profileEditable(m.status))
      throw new DomainError('INVALID_STATE', 'Verification details are locked while under review or live.');
    return step(this.kyc, { type: 'merchant', id: m.id }, { type: 'user', id: ownerUserId }, ...args);
  }

  async addStaff(ownerUserId: string, input: { name: string; phone: string }): Promise<StaffRecord> {
    const m = await this.owned(ownerUserId);
    const phone = normalizeIndianMobile(input.phone);
    const staff = await this.repo.staff(m.id);
    if (staff.length >= MAX_STAFF) throw new DomainError('VALIDATION_FAILED', `A store can have up to ${MAX_STAFF} staff.`);
    if (staff.some((s) => s.phone === phone)) throw new DomainError('ALREADY_EXISTS', 'This person is already on your staff list.');
    return this.repo.transaction(async (tx) => {
      const s = await tx.addStaff({ merchantId: m.id, name: input.name.trim(), phone });
      await tx.appendEvent({
        type: 'merchant.staff_added',
        aggregate: { type: 'merchant', id: m.id },
        microMarketId: m.microMarketId,
        actor: { type: 'user', id: ownerUserId },
        payload: { merchant_id: m.id, staff_id: s.id },
      });
      return s;
    });
  }

  async removeStaff(ownerUserId: string, staffId: string): Promise<void> {
    const m = await this.owned(ownerUserId);
    const removed = await this.repo.transaction((tx) => tx.removeStaff(m.id, staffId));
    if (!removed) throw new DomainError('NOT_FOUND', 'Staff member not found');
  }

  async submit(ownerUserId: string): Promise<MerchantView> {
    const m = await this.owned(ownerUserId);
    if (!profileEditable(m.status)) throw new DomainError('INVALID_STATE', `Your store is already ${m.status}.`);
    const missing = missingSteps(checklist(m, await this.kyc.list({ type: 'merchant', id: m.id })));
    if (missing.length) throw new DomainError('CHECKLIST_INCOMPLETE', 'Finish all the steps before submitting.', { missing });
    const merchant = await this.repo.transaction(async (tx) => {
      const locked = await tx.lock(m.id);
      if (!locked || !profileEditable(locked.status)) throw new DomainError('INVALID_STATE', 'Your store was already submitted.');
      const updated = await tx.update(m.id, { status: 'submitted', submittedAt: this.clock(), rejectionCode: null, rejectionNote: null });
      await tx.appendEvent({
        type: 'merchant.submitted',
        aggregate: { type: 'merchant', id: m.id },
        microMarketId: m.microMarketId,
        actor: { type: 'user', id: ownerUserId },
        payload: { merchant_id: m.id, resubmission: locked.status === 'rejected' },
      });
      return updated;
    });
    return this.view(merchant);
  }

  // ───────── ops console ─────────

  async queue(q: Partial<MerchantQuery>): Promise<MerchantView[]> {
    const rows = await this.repo.list({ status: q.status, microMarketId: q.microMarketId, limit: Math.min(q.limit ?? 100, MAX_LIST) });
    return Promise.all(rows.map((m) => this.view(m)));
  }

  async detail(id: string): Promise<MerchantView> {
    const m = await this.repo.get(id);
    if (!m) throw new DomainError('NOT_FOUND', 'Merchant not found');
    return this.view(m);
  }

  async approve(id: string, actor: OpsActor, note?: string): Promise<MerchantView> {
    return this.decide(id, actor, ['submitted'], async (m) => {
      const missing = missingSteps(checklist(m, await this.kyc.list({ type: 'merchant', id: m.id })));
      if (missing.length)
        throw new DomainError('CHECKLIST_INCOMPLETE', 'This merchant has incomplete or failed checks.', { missing });
      return {
        patch: { status: 'approved', decidedAt: this.clock(), decidedBy: actor.userId },
        event: { type: 'merchant.approved', payload: { merchant_id: m.id } },
        action: 'approved',
        note,
      };
    });
  }

  async reject(id: string, actor: OpsActor, input: { reasonCode: RejectionCode; note?: string | undefined }): Promise<MerchantView> {
    return this.decide(id, actor, ['submitted', 'approved'], async (m) => ({
      patch: {
        status: 'rejected',
        decidedAt: this.clock(),
        decidedBy: actor.userId,
        rejectionCode: input.reasonCode,
        rejectionNote: input.note?.trim() || null,
      },
      event: { type: 'merchant.rejected', payload: { merchant_id: m.id, reason_code: input.reasonCode } },
      action: 'rejected',
      note: input.note,
    }));
  }

  /** "No food merchant goes live without a valid FSSAI number" (FR-TRS-1) — re-checked here. */
  async goLive(id: string, actor: OpsActor): Promise<MerchantView> {
    return this.decide(id, actor, ['approved'], async (m) => {
      const kyc = await this.kyc.list({ type: 'merchant', id: m.id });
      if (needsFssai(m) && !kyc.some((c) => c.kind === 'fssai' && c.status === 'verified'))
        throw new DomainError('CHECKLIST_INCOMPLETE', 'A food merchant cannot go live without a verified FSSAI number.', {
          missing: ['fssai'],
        });
      if (!m.microMarketId) throw new DomainError('NOT_SERVICEABLE', 'The store is outside every micro-market.');
      return {
        patch: { status: 'live', liveAt: this.clock() },
        event: { type: 'merchant.went_live', payload: { merchant_id: m.id, type: m.type, micro_market_id: m.microMarketId } },
        action: 'went_live',
      };
    });
  }

  private async decide(
    id: string,
    actor: OpsActor,
    from: MerchantRecord['status'][],
    plan: (m: MerchantRecord) => Promise<{
      patch: MerchantPatch;
      event: { type: string; payload: Record<string, unknown> };
      action: string;
      note?: string | undefined;
    }>,
  ): Promise<MerchantView> {
    const current = await this.repo.get(id);
    if (!current) throw new DomainError('NOT_FOUND', 'Merchant not found');
    if (!from.includes(current.status))
      throw new DomainError('INVALID_STATE', `This merchant is ${current.status}; that action needs ${from.join(' or ')}.`);
    const p = await plan(current);
    const merchant = await this.repo.transaction(async (tx) => {
      const locked = await tx.lock(id);
      if (!locked || locked.status !== current.status)
        throw new DomainError('INVALID_STATE', 'Someone else changed this merchant. Refresh and try again.');
      const updated = await tx.update(id, p.patch);
      await tx.appendEvent({
        type: p.event.type,
        aggregate: { type: 'merchant', id },
        microMarketId: updated.microMarketId,
        actor: { type: 'ops', id: actor.userId },
        payload: p.event.payload,
      });
      await tx.appendAudit({
        entity: 'merchant',
        entityId: id,
        action: p.action,
        actorId: actor.userId,
        microMarketId: updated.microMarketId,
        before: { status: locked.status },
        after: {
          status: updated.status,
          ...(updated.rejectionCode && p.action === 'rejected' ? { rejectionCode: updated.rejectionCode } : {}),
          ...(p.note ? { note: p.note } : {}),
        },
        requestId: actor.requestId ?? null,
      });
      return updated;
    });
    return this.view(merchant);
  }

  private async owned(ownerUserId: string): Promise<MerchantRecord> {
    const m = await this.repo.findByOwner(ownerUserId);
    if (!m) throw new DomainError('NOT_FOUND', 'You have not started a store yet.');
    return m;
  }

  private async view(m: MerchantRecord): Promise<MerchantView> {
    const [staff, kyc, mm] = await Promise.all([
      this.repo.staff(m.id),
      this.kyc.list({ type: 'merchant', id: m.id }),
      m.microMarketId ? this.markets.get(m.microMarketId).catch(() => null) : Promise.resolve(null),
    ]);
    return {
      merchant: m,
      staff,
      kyc,
      checklist: checklist(m, kyc),
      microMarket: mm ? { id: mm.market.id, slug: mm.market.slug, name: mm.market.name, nameTe: mm.market.nameTe } : null,
    };
  }
}
