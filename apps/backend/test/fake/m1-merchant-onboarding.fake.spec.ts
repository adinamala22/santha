/**
 * M1 acceptance (fake mode): "a merchant onboarded on the app appears in the admin queue and can be
 * approved to live; FSSAI is mandatory for food types; audit rows exist for every ops action."
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS, SEED_OUTSIDE_POINT } from '../../src/dev/seed-data';
import { gstinCheckChar, verhoeffCheckDigit } from '../../src/modules/identity-kyc/domain/kyc-formats';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const aadhaar = (base11: string) => base11 + verhoeffCheckDigit(base11);
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '11:00', close: '21:00' }]]));
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!;

describe('M1 · merchant onboarding → review → live (fake mode)', () => {
  let fake: FakeApp;
  let ops: Session;
  let owner: Session;
  const http = () => fake.http();

  beforeAll(async () => {
    fake = await bootFakeApp();
    ops = await fake.opsSignIn();
    owner = await fake.signIn('9876500201', 'merchant'); // brand-new home cook
  });

  afterAll(async () => {
    await fake.close();
  });

  const me = () => http().get('/v1/merchants/me').set(owner.headers).expect(200);
  const missing = (body: { checklist: Array<{ key: string; done: boolean }> }) =>
    body.checklist.filter((i) => !i.done).map((i) => i.key);

  it('a new home kitchen starts as a draft with the food-seller steps', async () => {
    await http().get('/v1/merchants/me').set(owner.headers).expect(404);
    const res = await http()
      .post('/v1/merchants')
      .set(owner.headers)
      .send({ type: 'home_kitchen', name: "Lakshmi's Kitchen", sellsFood: false })
      .expect(201);
    expect(res.body.merchant).toMatchObject({ status: 'draft', type: 'home_kitchen', sellsFood: true }); // kitchens always sell food
    expect(missing(res.body)).toEqual(['location', 'hours', 'pan', 'aadhaar', 'gst', 'fssai', 'bank', 'hygiene']);
    expect(res.body.canSubmit).toBe(false);
    await http().post('/v1/merchants').set(owner.headers).send({ type: 'retail', name: 'Second store' }).expect(409);
  });

  it('cannot submit an incomplete store', async () => {
    const res = await http().post('/v1/merchants/me/submit').set(owner.headers).expect(422);
    expect(res.body.error).toMatchObject({ code: 'CHECKLIST_INCOMPLETE', details: { missing: expect.arrayContaining(['fssai']) } });
  });

  it('location resolves the micro-market (and outside means not serviceable)', async () => {
    const outside = await http().patch('/v1/merchants/me').set(owner.headers).send({ location: SEED_OUTSIDE_POINT }).expect(200);
    expect(outside.body.microMarket).toBeNull();
    const res = await http()
      .patch('/v1/merchants/me')
      .set(owner.headers)
      .send({
        location: { lat: dargamitta.centre.lat + 0.001, lng: dargamitta.centre.lng },
        addressLine: '22-1, Dargamitta Temple Street',
        pincode: '524003',
        hours,
        hygieneDeclared: true,
        radiusM: 3000,
        movPaise: 9900,
        defaultFulfilment: 'rider',
      })
      .expect(200);
    expect(res.body.microMarket.slug).toBe('dargamitta');
    expect(missing(res.body)).toEqual(['pan', 'aadhaar', 'gst', 'fssai', 'bank']);
  });

  it('PAN: format errors are 400, provider failures are stored with a reason, success is masked', async () => {
    const bad = await http().put('/v1/merchants/me/kyc/pan').set(owner.headers).send({ pan: 'ABCDE1234F', name: 'Lakshmi' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const failed = await http().put('/v1/merchants/me/kyc/pan').set(owner.headers).send({ pan: 'ABCPL0000K', name: 'Lakshmi' }).expect(200);
    expect(failed.body).toMatchObject({ kind: 'pan', status: 'failed', failureReason: expect.any(String) });
    const ok = await http().put('/v1/merchants/me/kyc/pan').set(owner.headers).send({ pan: 'abcpl1234k', name: 'Lakshmi Devi' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'verified', valueMasked: 'AB******4K', nameOnRecord: 'LAKSHMI DEVI' });
    expect(JSON.stringify(ok.body)).not.toContain('ABCPL1234K'); // never stored or returned in full
  });

  it('Aadhaar eKYC: start → wrong OTP fails → restart → verified', async () => {
    const number = aadhaar('23456789012');
    const start = await http().post('/v1/merchants/me/kyc/aadhaar/start').set(owner.headers).send({ aadhaar: number }).expect(200);
    expect(start.body).toMatchObject({ status: 'pending', valueMasked: `XXXX XXXX ${number.slice(-4)}` });
    const wrong = await http().post('/v1/merchants/me/kyc/aadhaar/verify').set(owner.headers).send({ otp: '000000' }).expect(200);
    expect(wrong.body.status).toBe('failed');
    await http().post('/v1/merchants/me/kyc/aadhaar/verify').set(owner.headers).send({ otp: '123456' }).expect(409); // must restart
    await http().post('/v1/merchants/me/kyc/aadhaar/start').set(owner.headers).send({ aadhaar: number }).expect(200);
    const ok = await http().post('/v1/merchants/me/kyc/aadhaar/verify').set(owner.headers).send({ otp: '123456' }).expect(200);
    expect(ok.body.status).toBe('verified');
  });

  it('GST: invalid GSTIN checksum is rejected; exemption declaration is accepted', async () => {
    const valid = gstin('37ABCPL1234K1Z');
    const wrongCheck = valid.slice(0, 14) + (valid[14] === 'A' ? 'B' : 'A');
    await http().put('/v1/merchants/me/kyc/gstin').set(owner.headers).send({ gstin: wrongCheck }).expect(400);
    const g = await http().put('/v1/merchants/me/kyc/gstin').set(owner.headers).send({ gstin: valid }).expect(200);
    expect(g.body).toMatchObject({ status: 'verified', valuePublic: valid, details: { panMatchesKyc: true } });
    const ex = await http()
      .put('/v1/merchants/me/kyc/gst-exemption')
      .set(owner.headers)
      .send({ reason: 'Turnover below the GST threshold' })
      .expect(200);
    expect(ex.body).toMatchObject({ kind: 'gst_exemption', status: 'verified', provider: 'self-declaration' });
  });

  it('bank penny-drop', async () => {
    await http().put('/v1/merchants/me/kyc/bank').set(owner.headers).send({ accountNumber: '123456789012', ifsc: 'SBIN1001234', holderName: 'Lakshmi' }).expect(400);
    const ok = await http()
      .put('/v1/merchants/me/kyc/bank')
      .set(owner.headers)
      .send({ accountNumber: '1234 5678 9012', ifsc: 'sbin0001234', holderName: 'Lakshmi Devi' })
      .expect(200);
    expect(ok.body).toMatchObject({ status: 'verified', valueMasked: '•••• 9012', details: { ifsc: 'SBIN0001234' } });
  });

  it('FSSAI is mandatory for a food seller: submit is blocked until it is verified', async () => {
    const blocked = await http().post('/v1/merchants/me/submit').set(owner.headers).expect(422);
    expect(blocked.body.error.details.missing).toEqual(['fssai']);
    const failed = await http().put('/v1/merchants/me/kyc/fssai').set(owner.headers).send({ number: '22345678900000' }).expect(200);
    expect(failed.body.status).toBe('failed');
    expect((await http().post('/v1/merchants/me/submit').set(owner.headers).expect(422)).body.error.details.missing).toEqual(['fssai']);
    const ok = await http().put('/v1/merchants/me/kyc/fssai').set(owner.headers).send({ number: '22345678901234' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'verified', valuePublic: '22345678901234', details: { kind: 'registration' } });
    expect((await me()).body.canSubmit).toBe(true);
  });

  it('staff can be added and removed; duplicates are refused', async () => {
    const s = await http().post('/v1/merchants/me/staff').set(owner.headers).send({ name: 'Ravi', phone: '9876511111' }).expect(201);
    expect(s.body).toMatchObject({ name: 'Ravi', phoneMasked: '+9198******11' });
    await http().post('/v1/merchants/me/staff').set(owner.headers).send({ name: 'Ravi again', phone: '+919876511111' }).expect(409);
    await http().delete(`/v1/merchants/me/staff/${s.body.id}`).set(owner.headers).expect(204);
    await http().post('/v1/merchants/me/staff').set(owner.headers).send({ name: 'Ravi', phone: '9876511111' }).expect(201);
  });

  let merchantId: string;

  it('submits; profile and KYC lock, operational settings stay editable', async () => {
    const res = await http().post('/v1/merchants/me/submit').set(owner.headers).expect(200);
    merchantId = res.body.merchant.id;
    expect(res.body.merchant).toMatchObject({ status: 'submitted', submittedAt: expect.any(String) });
    await http().patch('/v1/merchants/me').set(owner.headers).send({ name: 'New name' }).expect(409);
    await http().put('/v1/merchants/me/kyc/pan').set(owner.headers).send({ pan: 'ABCPL1234K', name: 'x y' }).expect(409);
    const op = await http().patch('/v1/merchants/me').set(owner.headers).send({ radiusM: 2500 }).expect(200);
    expect(op.body.merchant.radiusM).toBe(2500);
    await http().post('/v1/merchants/me/submit').set(owner.headers).expect(409);
  });

  it('appears in the ops queue after the older seeded submissions', async () => {
    const q = await http().get('/v1/ops/merchants?status=submitted').set(ops.headers).expect(200);
    const names = q.body.items.map((i: { merchant: { name: string } }) => i.merchant.name);
    const seededSubmitted = SEED_MERCHANTS.filter((m) => m.status === 'submitted').map((m) => m.name);
    expect(names).toEqual([...seededSubmitted, "Lakshmi's Kitchen"]);
    const detail = await http().get(`/v1/ops/merchants/${merchantId}`).set(ops.headers).expect(200);
    expect(detail.body.kyc.map((k: { kind: string }) => k.kind).sort()).toEqual(['aadhaar', 'bank', 'fssai', 'gst_exemption', 'gstin', 'pan']);
  });

  it('illegal transitions are refused', async () => {
    const live = await http().post(`/v1/ops/merchants/${merchantId}/go-live`).set(ops.headers).expect(409);
    expect(live.body.error.code).toBe('INVALID_STATE');
    await http().post(`/v1/ops/merchants/${merchantId}/approve`).set(owner.headers).send({}).expect(403); // owner is not ops
  });

  it('ops approve → go live; the owner sees it; both actions are audited', async () => {
    const approved = await http().post(`/v1/ops/merchants/${merchantId}/approve`).set(ops.headers).send({ note: 'Documents clear' }).expect(200);
    expect(approved.body.merchant.status).toBe('approved');
    const live = await http().post(`/v1/ops/merchants/${merchantId}/go-live`).set(ops.headers).expect(200);
    expect(live.body.merchant).toMatchObject({ status: 'live', liveAt: expect.any(String) });
    expect((await me()).body.merchant.status).toBe('live');

    const audit = await http().get(`/v1/ops/audit?entity=merchant&entityId=${merchantId}`).set(ops.headers).expect(200);
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(['went_live', 'approved']);
    expect(audit.body.items[1]).toMatchObject({
      actorId: ops.user.id,
      before: { status: 'submitted' },
      after: { status: 'approved', note: 'Documents clear' },
      requestId: expect.any(String),
    });
  });

  it('reject with a reason → owner fixes and resubmits → back in the queue', async () => {
    const footwear = SEED_MERCHANTS.find((m) => m.name === 'Nellore Footwear')!;
    const rej = await http()
      .post(`/v1/ops/merchants/${footwear.id}/reject`)
      .set(ops.headers)
      .send({ reasonCode: 'documents_unclear', note: 'Return policy must mention refunds' })
      .expect(200);
    expect(rej.body.merchant).toMatchObject({ status: 'rejected', rejectionCode: 'documents_unclear' });

    const owner2 = await fake.signIn(footwear.ownerPhone, 'merchant');
    const mine = await http().get('/v1/merchants/me').set(owner2.headers).expect(200);
    expect(mine.body.merchant.rejectionNote).toBe('Return policy must mention refunds');
    await http()
      .patch('/v1/merchants/me')
      .set(owner2.headers)
      .send({ returnPolicy: 'Size exchange or full refund within 48 hours if unused, original box required.' })
      .expect(200);
    const again = await http().post('/v1/merchants/me/submit').set(owner2.headers).expect(200);
    expect(again.body.merchant).toMatchObject({ status: 'submitted', rejectionCode: null });

    const audit = await http().get(`/v1/ops/audit?entity=merchant&entityId=${footwear.id}`).set(ops.headers).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'rejected', after: { status: 'rejected', rejectionCode: 'documents_unclear' } });
  });

  it('rejection needs a known reason code', async () => {
    const kitchen = SEED_MERCHANTS.find((m) => m.name === 'Annapurna Tiffins')!;
    const res = await http().post(`/v1/ops/merchants/${kitchen.id}/reject`).set(ops.headers).send({ reasonCode: 'bad_vibes' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a seeded draft cannot be approved', async () => {
    const draft = SEED_MERCHANTS.find((m) => m.status === 'draft')!;
    await http().post(`/v1/ops/merchants/${draft.id}/approve`).set(ops.headers).send({}).expect(409);
  });

  it('consumers cannot use the merchant API', async () => {
    const consumer = await fake.signIn(fake.seeded('consumer').phone, 'consumer');
    await http().get('/v1/merchants/me').set(consumer.headers).expect(403);
  });
});
