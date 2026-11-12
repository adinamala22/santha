/**
 * Manual KYC (ADR-041), fake mode with KYC_PROVIDER=manual: no vendor is called. A merchant's numbers are recorded as
 * typed and marked manual so ops compare them with the documents; a bad format is still refused; the merchant can
 * finish the checklist and reach the ops review queue.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckChar, verhoeffCheckDigit } from '../../src/modules/identity-kyc/domain/kyc-formats';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const aadhaar = (base11: string) => base11 + verhoeffCheckDigit(base11);
const gstin = (first14: string) => first14 + gstinCheckChar(first14);

describe('Manual KYC (ADR-041, fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  const http = () => fake.http();

  beforeAll(async () => {
    fake = await bootFakeApp({ KYC_PROVIDER: 'manual' });
    owner = await fake.signIn('9876500777', 'merchant');
    await http().post('/v1/merchants').set(owner.headers).send({ type: 'retail', name: 'Manual Stores', sellsFood: false }).expect(201);
  }, 60_000);
  afterAll(() => fake?.close());

  const checks = async () => (await http().get('/v1/merchants/me').set(owner.headers).expect(200)).body.kyc as Array<{ kind: string; status: string; provider: string; details: Record<string, unknown> | null }>;

  it('records numbers as typed, marked manual; formats are still validated', async () => {
    await http().put('/v1/merchants/me/kyc/pan').set(owner.headers).send({ pan: 'ABCDE1234F', name: 'Ravi' }).expect(400); // bad PAN format
    const pan = (await http().put('/v1/merchants/me/kyc/pan').set(owner.headers).send({ pan: 'ABCPL1234K', name: 'Ravi Kumar' }).expect(200)).body;
    expect(pan).toMatchObject({ kind: 'pan', status: 'verified', provider: 'manual', details: { manual: true } });

    const number = aadhaar('23456789012');
    await http().post('/v1/merchants/me/kyc/aadhaar/start').set(owner.headers).send({ aadhaar: number }).expect(200);
    await http().post('/v1/merchants/me/kyc/aadhaar/verify').set(owner.headers).send({ otp: '12ab' }).expect(400); // the API takes digits only
    expect((await http().post('/v1/merchants/me/kyc/aadhaar/verify').set(owner.headers).send({ otp: '654321' }).expect(200)).body).toMatchObject({ status: 'verified', provider: 'manual' });

    const gst = (await http().put('/v1/merchants/me/kyc/gstin').set(owner.headers).send({ gstin: gstin('37ABCPL1234K1Z') }).expect(200)).body;
    expect(gst).toMatchObject({ kind: 'gstin', provider: 'manual' });
    const manual = (await checks()).filter((c) => ['pan', 'aadhaar', 'gstin'].includes(c.kind));
    expect(manual.every((c) => c.provider === 'manual' && c.details?.manual === true)).toBe(true);
  });
});
