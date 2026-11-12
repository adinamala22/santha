import { describe, expect, it } from 'vitest';
import { ManualKycProvider } from './kyc.provider';

describe('ManualKycProvider (ADR-041)', () => {
  const p = new ManualKycProvider();

  it('records every check as entered and marks it manual, so ops know to compare with the documents', async () => {
    for (const r of [await p.verifyPan(), await p.verifyGstin(), await p.verifyFssai(), await p.pennyDrop()]) {
      expect(r.ok).toBe(true);
      expect(r.providerRef).toMatch(/^manual-/);
      expect(r.details).toMatchObject({ manual: true });
      expect(r.nameOnRecord).toBeUndefined();
    }
  });

  it('the Aadhaar step takes a 6-digit code and nothing else', async () => {
    const { requestId } = await p.startAadhaarOtp();
    expect(await p.verifyAadhaarOtp({ requestId, otp: '12ab' })).toMatchObject({ ok: false });
    expect(await p.verifyAadhaarOtp({ requestId, otp: '654321' })).toMatchObject({ ok: true, details: { manual: true } });
  });
});
