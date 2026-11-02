import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../common/errors/domain-error';

export interface KycResult {
  ok: boolean;
  providerRef: string;
  /** Name as held by the issuing authority (PAN, Aadhaar, GST, FSSAI, bank). */
  nameOnRecord?: string | undefined;
  failureReason?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

/**
 * KYC/verification provider port (Digio or Signzy in production — tech plan §5). Implementations:
 * `mock` (dev/test/fake mode) and `digio` (live, wired at launch). Dev and test never reach a live
 * provider. Inputs are already format-validated by the caller.
 */
export abstract class KycProvider {
  abstract readonly name: string;
  abstract verifyPan(input: { pan: string; name: string }): Promise<KycResult>;
  /** Sends an OTP to the Aadhaar-linked mobile; returns a provider request id. */
  abstract startAadhaarOtp(input: { aadhaar: string }): Promise<{ requestId: string }>;
  abstract verifyAadhaarOtp(input: { requestId: string; otp: string }): Promise<KycResult>;
  abstract verifyGstin(input: { gstin: string }): Promise<KycResult>;
  abstract verifyFssai(input: { number: string }): Promise<KycResult>;
  /** Penny-drop: deposits ₹1 and returns the account holder's name. */
  abstract pennyDrop(input: { accountNumber: string; ifsc: string; holderName: string }): Promise<KycResult>;
}

/** Digits "0000" in these positions make the mock fail, so failure paths are easy to demo and test. */
export const MOCK_KYC_FAIL_HINT =
  'Mock KYC fails PAN with digits 0000, Aadhaar/bank account ending 0000, GSTIN whose PAN has 0000, FSSAI ending 0000; Aadhaar OTP is 123456.';

/**
 * Deterministic mock. Succeeds unless the number contains the failure marker documented in
 * MOCK_KYC_FAIL_HINT. Aadhaar OTP is always 123456 (like the SMS mock).
 */
@Injectable()
export class MockKycProvider extends KycProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockKycProvider');
  private readonly aadhaarRequests = new Map<string, { last4: string; fail: boolean }>();

  async verifyPan({ pan, name }: { pan: string; name: string }): Promise<KycResult> {
    const fail = pan.slice(5, 9) === '0000';
    return this.result(fail, 'PAN not found in the income tax records', name.toUpperCase(), { panType: pan[3] });
  }

  async startAadhaarOtp({ aadhaar }: { aadhaar: string }): Promise<{ requestId: string }> {
    const requestId = `mock-aadhaar-${randomUUID()}`;
    this.aadhaarRequests.set(requestId, { last4: aadhaar.slice(-4), fail: aadhaar.endsWith('0000') });
    this.logger.log('[mock-kyc] Aadhaar OTP is 123456');
    return { requestId };
  }

  async verifyAadhaarOtp({ requestId, otp }: { requestId: string; otp: string }): Promise<KycResult> {
    const req = this.aadhaarRequests.get(requestId);
    if (!req) return this.result(true, 'This verification has expired. Start again.');
    if (otp !== '123456') return { ok: false, providerRef: requestId, failureReason: 'The Aadhaar OTP is not right.' };
    this.aadhaarRequests.delete(requestId);
    return this.result(req.fail, 'Aadhaar could not be verified', 'DEMO AADHAAR HOLDER', { last4: req.last4 });
  }

  async verifyGstin({ gstin }: { gstin: string }): Promise<KycResult> {
    const fail = gstin.slice(7, 11) === '0000';
    return this.result(fail, 'GSTIN is not active', 'DEMO TRADERS', { status: 'Active', stateCode: gstin.slice(0, 2) });
  }

  async verifyFssai({ number }: { number: string }): Promise<KycResult> {
    const fail = number.endsWith('0000');
    const kind = number.startsWith('1') ? 'licence' : 'registration';
    return this.result(fail, 'FSSAI number not found or expired', 'DEMO FOOD BUSINESS', { kind, validUpto: '2028-03-31' });
  }

  async pennyDrop({ accountNumber, holderName }: { accountNumber: string; ifsc: string; holderName: string }): Promise<KycResult> {
    const fail = accountNumber.endsWith('0000');
    return this.result(fail, 'The bank could not verify this account', holderName.toUpperCase());
  }

  private result(fail: boolean, reason: string, name?: string, details?: Record<string, unknown>): KycResult {
    const providerRef = `mock-${randomUUID()}`;
    return fail ? { ok: false, providerRef, failureReason: reason } : { ok: true, providerRef, nameOnRecord: name, details };
  }
}

/** Live provider — contract and sandbox keys are a launch task (tech plan §11). Fails loudly until wired. */
@Injectable()
export class DigioKycProvider extends KycProvider {
  readonly name = 'digio';
  private unavailable(): never {
    throw new DomainError('PROVIDER_UNAVAILABLE', 'Verification is not available right now. Please try again later.');
  }
  verifyPan(): Promise<KycResult> {
    this.unavailable();
  }
  startAadhaarOtp(): Promise<{ requestId: string }> {
    this.unavailable();
  }
  verifyAadhaarOtp(): Promise<KycResult> {
    this.unavailable();
  }
  verifyGstin(): Promise<KycResult> {
    this.unavailable();
  }
  verifyFssai(): Promise<KycResult> {
    this.unavailable();
  }
  pennyDrop(): Promise<KycResult> {
    this.unavailable();
  }
}
