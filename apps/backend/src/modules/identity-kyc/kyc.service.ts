import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { KycProvider, type KycResult } from '../../infra/providers/kyc/kyc.provider';
import {
  isAadhaar,
  isBankAccount,
  isDrugLicence,
  isFssai,
  isGstin,
  isIfsc,
  isPan,
  maskAadhaar,
  maskAccount,
  maskPan,
  panOfGstin,
} from './domain/kyc-formats';
import { type KycCheckInput, type KycCheckRecord, type KycKind, KycRepository, type Subject } from './kyc.repository';

export type { KycCheckRecord, KycKind, Subject };

export interface KycActor {
  type: 'user' | 'ops';
  id: string;
}

const invalid = (message: string, field: string) => new DomainError('VALIDATION_FAILED', message, { field });

/**
 * KYC checks for merchants (M1) and riders (M6). Validates formats locally, calls the provider,
 * and stores one check per (subject, kind) with event `<subject>.kyc_updated`. A failed check is
 * stored and returned (status `failed` with a human reason) — it is not an exception, so the app
 * can show the reason and let the person correct the number.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly repo: KycRepository,
    private readonly provider: KycProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(subject: Subject): Promise<KycCheckRecord[]> {
    return this.repo.list(subject);
  }

  async verifyPan(subject: Subject, input: { pan: string; name: string }, actor: KycActor): Promise<KycCheckRecord> {
    const pan = input.pan.trim().toUpperCase();
    if (!isPan(pan)) throw invalid('Enter a valid 10-character PAN, like ABCPE1234F.', 'pan');
    const r = await this.call(() => this.provider.verifyPan({ pan, name: input.name.trim() }));
    return this.save(subject, 'pan', r, { valueMasked: maskPan(pan), valuePublic: null }, actor);
  }

  async startAadhaar(subject: Subject, input: { aadhaar: string }, actor: KycActor): Promise<KycCheckRecord> {
    const aadhaar = input.aadhaar.replace(/\s/g, '');
    if (!isAadhaar(aadhaar)) throw invalid('Enter your 12-digit Aadhaar number.', 'aadhaar');
    const { requestId } = await this.call(() => this.provider.startAadhaarOtp({ aadhaar }));
    return this.persist(subject, {
      kind: 'aadhaar',
      status: 'pending',
      valueMasked: maskAadhaar(aadhaar),
      valuePublic: null,
      nameOnRecord: null,
      provider: this.provider.name,
      providerRef: requestId,
      failureReason: null,
      details: null,
      verifiedAt: null,
    }, actor);
  }

  async completeAadhaar(subject: Subject, input: { otp: string }, actor: KycActor): Promise<KycCheckRecord> {
    const pending = await this.repo.get(subject, 'aadhaar');
    if (!pending || pending.status !== 'pending' || !pending.providerRef)
      throw new DomainError('INVALID_STATE', 'Start Aadhaar verification first.');
    const r = await this.call(() => this.provider.verifyAadhaarOtp({ requestId: pending.providerRef!, otp: input.otp }));
    return this.save(subject, 'aadhaar', r, { valueMasked: pending.valueMasked, valuePublic: null }, actor);
  }

  async verifyGstin(subject: Subject, input: { gstin: string }, actor: KycActor): Promise<KycCheckRecord> {
    const gstin = input.gstin.trim().toUpperCase();
    if (!isGstin(gstin)) throw invalid('Enter a valid 15-character GSTIN.', 'gstin');
    const pan = await this.repo.get(subject, 'pan');
    const r = await this.call(() => this.provider.verifyGstin({ gstin }));
    const details = { ...r.details, panMatchesKyc: pan?.valueMasked ? maskPan(panOfGstin(gstin)) === pan.valueMasked : null };
    return this.save(subject, 'gstin', { ...r, details }, { valueMasked: null, valuePublic: gstin }, actor);
  }

  /** GST registration is optional for small sellers: a self-declaration replaces the GSTIN (PRD 7.2). */
  async declareGstExemption(subject: Subject, input: { reason: string }, actor: KycActor): Promise<KycCheckRecord> {
    return this.persist(subject, {
      kind: 'gst_exemption',
      status: 'verified',
      valueMasked: null,
      valuePublic: null,
      nameOnRecord: null,
      provider: 'self-declaration',
      providerRef: null,
      failureReason: null,
      details: { reason: input.reason.trim() },
      verifiedAt: this.clock(),
    }, actor);
  }

  async verifyFssai(subject: Subject, input: { number: string }, actor: KycActor): Promise<KycCheckRecord> {
    const number = input.number.replace(/\s/g, '');
    if (!isFssai(number)) throw invalid('Enter the 14-digit FSSAI licence or registration number.', 'number');
    const r = await this.call(() => this.provider.verifyFssai({ number }));
    return this.save(subject, 'fssai', r, { valueMasked: null, valuePublic: number }, actor);
  }

  async verifyBank(
    subject: Subject,
    input: { accountNumber: string; ifsc: string; holderName: string },
    actor: KycActor,
  ): Promise<KycCheckRecord> {
    const accountNumber = input.accountNumber.replace(/\s/g, '');
    const ifsc = input.ifsc.trim().toUpperCase();
    if (!isBankAccount(accountNumber)) throw invalid('Enter the account number (9 to 18 digits).', 'accountNumber');
    if (!isIfsc(ifsc)) throw invalid('Enter a valid IFSC, like SBIN0001234.', 'ifsc');
    const r = await this.call(() => this.provider.pennyDrop({ accountNumber, ifsc, holderName: input.holderName.trim() }));
    return this.save(subject, 'bank', { ...r, details: { ...r.details, ifsc } }, { valueMasked: maskAccount(accountNumber), valuePublic: null }, actor);
  }

  /** Pharmacies: the drug licence is captured here and checked by ops during review. */
  async recordDrugLicence(subject: Subject, input: { number: string }, actor: KycActor): Promise<KycCheckRecord> {
    const number = input.number.trim().toUpperCase();
    if (!isDrugLicence(number)) throw invalid('Enter the drug licence number as printed on the licence.', 'number');
    return this.persist(subject, {
      kind: 'drug_licence',
      status: 'pending',
      valueMasked: null,
      valuePublic: number,
      nameOnRecord: null,
      provider: 'manual-review',
      providerRef: null,
      failureReason: null,
      details: null,
      verifiedAt: null,
    }, actor);
  }

  private save(
    subject: Subject,
    kind: KycKind,
    r: KycResult,
    values: { valueMasked: string | null; valuePublic: string | null },
    actor: KycActor,
  ): Promise<KycCheckRecord> {
    return this.persist(subject, {
      kind,
      status: r.ok ? 'verified' : 'failed',
      ...values,
      nameOnRecord: r.nameOnRecord ?? null,
      provider: this.provider.name,
      providerRef: r.providerRef,
      failureReason: r.ok ? null : (r.failureReason ?? 'Verification failed'),
      details: r.details ?? null,
      verifiedAt: r.ok ? this.clock() : null,
    }, actor);
  }

  private persist(subject: Subject, check: KycCheckInput, actor: KycActor): Promise<KycCheckRecord> {
    return this.repo.save(subject, check, {
      type: `${subject.type}.kyc_updated`,
      aggregate: { type: subject.type, id: subject.id },
      actor,
      payload: { [`${subject.type}_id`]: subject.id, kind: check.kind, status: check.status, provider: check.provider },
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DomainError) throw err;
      this.logger.error({ err, provider: this.provider.name }, 'KYC provider call failed');
      throw new DomainError('PROVIDER_UNAVAILABLE', 'Verification is not available right now. Please try again later.');
    }
  }
}
