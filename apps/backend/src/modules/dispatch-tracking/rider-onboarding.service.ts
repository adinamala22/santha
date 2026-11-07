import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { isVehicleNumber, normalizeVehicleNumber } from '../identity-kyc/domain/kyc-formats';
import { type KycActor, type KycCheckRecord, KycService } from '../identity-kyc/kyc.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DispatchRepository, type RiderRecord, type RiderStatus } from './dispatch.repository';
import { DispatchService, type OpsActor } from './dispatch.service';

/** Vehicles a rider can deliver on. A cycle needs no registration number or driving licence. */
export const RIDER_VEHICLES = ['bike', 'scooter', 'electric', 'cycle'] as const;
export type RiderVehicle = (typeof RIDER_VEHICLES)[number];

export type RiderStepKey = 'profile' | 'identity' | 'driving_licence' | 'bank';

export interface RiderOnboardingView {
  rider: RiderRecord;
  checks: KycCheckRecord[];
  steps: Array<{ key: RiderStepKey; done: boolean }>;
  /** Details can be changed only before submitting, or after a rejection. */
  editable: boolean;
}

const EDITABLE: RiderStatus[] = ['draft', 'rejected'];
const needsLicence = (vehicle: string) => vehicle !== 'cycle';

/** Which onboarding steps are done (ADR-029). Aadhaar or PAN proves identity; ops check the licence by eye. */
export function riderSteps(r: RiderRecord, checks: KycCheckRecord[]): Array<{ key: RiderStepKey; done: boolean }> {
  const ok = (kind: KycCheckRecord['kind'], allowPending = false) =>
    checks.some((c) => c.kind === kind && (c.status === 'verified' || (allowPending && c.status === 'pending')));
  return [
    { key: 'profile', done: r.name.trim().length >= 2 && (!needsLicence(r.vehicle) || !!r.vehicleNumber) },
    { key: 'identity', done: ok('aadhaar') || ok('pan') },
    { key: 'driving_licence', done: !needsLicence(r.vehicle) || ok('driving_licence', true) },
    { key: 'bank', done: ok('bank') },
  ];
}

/**
 * Rider onboarding and ops review (ADR-029). Anyone can sign in to the rider app, but only riders that ops
 * approve can go online, receive offers or accept them (dispatch checks `status`). Each ops decision is audited
 * and the rider is told by push (SMS without the app).
 */
@Injectable()
export class RiderOnboardingService {
  constructor(
    private readonly repo: DispatchRepository,
    private readonly dispatch: DispatchService,
    private readonly kyc: KycService,
    private readonly notifications: NotificationsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(userId: string): Promise<RiderOnboardingView> {
    return this.build(await this.dispatch.rider(userId));
  }

  async updateProfile(userId: string, input: { name: string; vehicle: RiderVehicle; vehicleNumber?: string | undefined }) {
    const r = await this.editable(userId);
    let vehicleNumber: string | null = null;
    if (needsLicence(input.vehicle)) {
      vehicleNumber = normalizeVehicleNumber(input.vehicleNumber ?? '');
      if (!isVehicleNumber(vehicleNumber))
        throw new DomainError('VALIDATION_FAILED', 'Enter the number on your number plate, like AP 26 AB 1234.', {
          field: 'vehicleNumber',
        });
    }
    const next = await this.repo.updateRider(r.userId, { name: input.name.trim(), vehicle: input.vehicle, vehicleNumber });
    return this.build(next!);
  }

  /** Runs one KYC step with this rider as the subject; only while details are editable. */
  async runKyc(userId: string, step: (kyc: KycService, subject: { type: 'rider'; id: string }, actor: KycActor) => Promise<KycCheckRecord>) {
    const r = await this.editable(userId);
    return step(this.kyc, { type: 'rider', id: r.userId }, { type: 'user', id: userId });
  }

  async submit(userId: string): Promise<RiderOnboardingView> {
    const r = await this.editable(userId);
    const checks = await this.kyc.list({ type: 'rider', id: r.userId });
    const missing = riderSteps(r, checks).filter((s) => !s.done).map((s) => s.key);
    if (missing.length) throw new DomainError('CHECKLIST_INCOMPLETE', 'Finish all the steps before submitting.', { missing });
    const next = await this.repo.updateRider(r.userId, { status: 'submitted', submittedAt: this.clock(), statusNote: null });
    await this.repo.appendAudit({
      entity: 'rider',
      entityId: r.userId,
      action: 'rider.submitted',
      actorId: userId,
      before: { status: r.status },
      after: { status: 'submitted' },
    });
    return { rider: next!, checks, steps: riderSteps(next!, checks), editable: false };
  }

  // ───────── ops console ─────────

  async list(status?: RiderStatus[]): Promise<RiderRecord[]> {
    const rows = await this.repo.riders(status ? { status } : {});
    // Oldest submission first: the queue is worked in order.
    return rows.sort((a, b) => (a.submittedAt?.getTime() ?? Infinity) - (b.submittedAt?.getTime() ?? Infinity));
  }

  async detail(userId: string): Promise<RiderOnboardingView> {
    return this.build(await this.record(userId));
  }

  async approve(userId: string, actor: OpsActor, note?: string): Promise<RiderOnboardingView> {
    const r = await this.record(userId);
    if (r.status !== 'submitted' && r.status !== 'suspended')
      throw new DomainError('INVALID_STATE', `This rider is ${r.status}.`, { status: r.status });
    if (r.status === 'submitted') {
      const missing = riderSteps(r, await this.kyc.list({ type: 'rider', id: r.userId })).filter((s) => !s.done);
      if (missing.length)
        throw new DomainError('CHECKLIST_INCOMPLETE', 'This rider has incomplete or failed checks.', {
          missing: missing.map((s) => s.key),
        });
    }
    return this.decide(r, 'approved', actor, note?.trim() || null, 'rider.approved');
  }

  async reject(userId: string, actor: OpsActor, reason: string): Promise<RiderOnboardingView> {
    const r = await this.record(userId);
    if (r.status !== 'submitted') throw new DomainError('INVALID_STATE', `This rider is ${r.status}.`, { status: r.status });
    return this.decide(r, 'rejected', actor, reason.trim(), 'rider.rejected');
  }

  /** Stops new offers at once. A delivery in hand is finished; the rider goes offline when it is done. */
  async suspend(userId: string, actor: OpsActor, reason: string): Promise<RiderOnboardingView> {
    const r = await this.record(userId);
    if (r.status !== 'approved') throw new DomainError('INVALID_STATE', `This rider is ${r.status}.`, { status: r.status });
    if (r.online && !(await this.dispatch.activeJobs(r.userId)).length) await this.dispatch.setStatus(r.userId, false, undefined);
    return this.decide(r, 'suspended', actor, reason.trim(), 'rider.suspended');
  }

  private async decide(r: RiderRecord, status: RiderStatus, actor: OpsActor, note: string | null, template: 'rider.approved' | 'rider.rejected' | 'rider.suspended') {
    const next = await this.repo.updateRider(r.userId, {
      status,
      statusNote: status === 'approved' ? null : note,
      decidedAt: this.clock(),
      decidedBy: actor.userId,
    });
    await this.repo.appendAudit({
      entity: 'rider',
      entityId: r.userId,
      action: template,
      actorId: actor.userId,
      requestId: actor.requestId,
      before: { status: r.status },
      after: { status, note },
    });
    await this.notifications.notify(template, { userId: r.userId }, { reason: note ?? '' }, {}, { data: { kind: 'rider_status' } });
    return this.build(next!);
  }

  private async editable(userId: string): Promise<RiderRecord> {
    const r = await this.dispatch.rider(userId);
    if (!EDITABLE.includes(r.status))
      throw new DomainError('INVALID_STATE', 'Your details are locked while under review or after approval.', { status: r.status });
    return r;
  }

  private async record(userId: string): Promise<RiderRecord> {
    const r = await this.repo.getRider(userId);
    if (!r) throw new DomainError('NOT_FOUND', 'Rider not found');
    return r;
  }

  private async build(r: RiderRecord): Promise<RiderOnboardingView> {
    const checks = await this.kyc.list({ type: 'rider', id: r.userId });
    return { rider: r, checks, steps: riderSteps(r, checks), editable: EDITABLE.includes(r.status) };
  }
}
