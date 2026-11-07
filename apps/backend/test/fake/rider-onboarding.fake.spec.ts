/**
 * Rider onboarding (ADR-029, rider audit B2), fake mode:
 *  - a new phone in the rider app is a draft rider: it cannot go online or take offers
 *  - steps: name + vehicle (number plate) → Aadhaar or PAN → driving licence → bank → submit (locked)
 *  - ops queue: reject with a reason (rider fixes and resubmits), approve (audited), pause and lift the pause
 *  - a cycle needs no number plate or driving licence
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootFakeApp, type FakeApp, type Session } from './harness';

describe('Rider onboarding and ops approval (fake mode, ADR-029)', () => {
  let fake: FakeApp;
  let ops: Record<string, string>;
  const http = () => fake.http();

  const onboarding = async (r: Session) => (await http().get('/v1/riders/me/onboarding').set(r.headers).expect(200)).body;
  const goOnline = (r: Session) => http().put('/v1/riders/me/status').set(r.headers).send({ online: true, zones: [] });
  const audit = async (userId: string) =>
    ((await http().get(`/v1/ops/audit?entity=rider&entityId=${userId}`).set(ops).expect(200)).body.items ?? []) as Array<{ action: string; after: Record<string, unknown> }>;

  async function fillAll(r: Session, vehicle: 'bike' | 'cycle' = 'bike') {
    await http()
      .put('/v1/riders/me/profile')
      .set(r.headers)
      .send({ name: 'Kiran Kumar', vehicle, ...(vehicle === 'bike' ? { vehicleNumber: 'ap 26 ab 4321' } : {}) })
      .expect(200);
    await http().put('/v1/riders/me/kyc/pan').set(r.headers).send({ pan: 'ABCPK1234K', name: 'Kiran Kumar' }).expect(200);
    if (vehicle === 'bike') await http().put('/v1/riders/me/kyc/driving-licence').set(r.headers).send({ number: 'AP26 2019 0012345' }).expect(200);
    await http().put('/v1/riders/me/kyc/bank').set(r.headers).send({ accountNumber: '123456789012', ifsc: 'SBIN0001234', holderName: 'Kiran Kumar' }).expect(200);
  }

  beforeAll(async () => {
    fake = await bootFakeApp();
    ops = (await fake.opsSignIn()).headers;
  }, 60_000);
  afterAll(() => fake?.close());

  it('a new rider is a draft: no going online until approved; the demo riders are already approved', async () => {
    const r = await fake.signIn('9876511001', 'rider');
    const home = (await http().get('/v1/riders/me').set(r.headers).expect(200)).body;
    expect(home).toMatchObject({ status: 'draft', statusNote: null, cashInHandPaise: 0, acceptancePct: null });
    const refused = await goOnline(r).expect(403);
    expect(refused.body.error).toMatchObject({ code: 'RIDER_NOT_APPROVED', details: { status: 'draft' } });

    const demo = await fake.signIn('9000000101', 'rider');
    expect((await http().get('/v1/riders/me').set(demo.headers).expect(200)).body.status).toBe('approved');
    await goOnline(demo).expect(200);
    await http().put('/v1/riders/me/status').set(demo.headers).send({ online: false }).expect(200);
  });

  it('steps: profile with a number plate, identity, licence, bank; then submit locks the details', async () => {
    const r = await fake.signIn('9876511002', 'rider');
    const start = await onboarding(r);
    expect(start).toMatchObject({ status: 'draft', editable: true, checks: [] });
    expect(start.steps.map((s: { key: string; done: boolean }) => `${s.key}:${s.done}`)).toEqual(['profile:false', 'identity:false', 'driving_licence:false', 'bank:false']);

    expect((await http().post('/v1/riders/me/submit').set(r.headers).expect(422)).body.error.details.missing).toEqual(['profile', 'identity', 'driving_licence', 'bank']);
    const plate = await http().put('/v1/riders/me/profile').set(r.headers).send({ name: 'Kiran', vehicle: 'bike', vehicleNumber: '1234' }).expect(400);
    expect(plate.body.error.details.field).toBe('vehicleNumber');
    const licence = await http().put('/v1/riders/me/kyc/driving-licence').set(r.headers).send({ number: 'NOT A LICENCE' }).expect(400);
    expect(licence.body.error.code).toBe('VALIDATION_FAILED');

    await fillAll(r);
    const done = await onboarding(r);
    expect(done).toMatchObject({ name: 'Kiran Kumar', vehicle: 'bike', vehicleNumber: 'AP26AB4321' });
    expect(done.steps.every((s: { done: boolean }) => s.done)).toBe(true);
    expect(done.checks.find((c: { kind: string }) => c.kind === 'driving_licence')).toMatchObject({ status: 'pending', valuePublic: 'AP2620190012345', provider: 'manual-review' });
    expect(JSON.stringify(done.checks)).not.toContain('123456789012'); // the account number is masked

    const sub = (await http().post('/v1/riders/me/submit').set(r.headers).expect(200)).body;
    expect(sub).toMatchObject({ status: 'submitted', editable: false, submittedAt: expect.any(String) });
    expect((await http().put('/v1/riders/me/kyc/bank').set(r.headers).send({ accountNumber: '999999999999', ifsc: 'SBIN0001234', holderName: 'Kiran Kumar' }).expect(409)).body.error.code).toBe('INVALID_STATE');
    await goOnline(r).expect(403); // waiting for ops
  });

  it('ops: queue → reject with a reason → the rider fixes and resubmits → approve (audited) → online', async () => {
    const r = await fake.signIn('9876511003', 'rider');
    await fillAll(r);
    await http().post('/v1/riders/me/submit').set(r.headers).expect(200);

    const queue = (await http().get('/v1/ops/riders?status=submitted').set(ops).expect(200)).body.items as Array<{ userId: string; phoneMasked: string; status: string }>;
    const row = queue.find((x) => x.userId === r.user.id)!;
    expect(row).toMatchObject({ status: 'submitted', vehicleNumber: 'AP26AB4321' });
    expect(row.phoneMasked).not.toContain('9876511003');
    expect(queue.every((x) => x.status === 'submitted')).toBe(true);
    const detail = (await http().get(`/v1/ops/riders/${r.user.id}`).set(ops).expect(200)).body;
    expect(detail.checks.map((c: { kind: string }) => c.kind).sort()).toEqual(['bank', 'driving_licence', 'pan']);

    await http().post(`/v1/ops/riders/${r.user.id}/reject`).set(ops).send({ reason: 'no' }).expect(400); // a real reason
    await http().post(`/v1/ops/riders/${r.user.id}/reject`).set(ops).send({ reason: 'The licence photo does not match the number.' }).expect(200);
    const home = (await http().get('/v1/riders/me').set(r.headers).expect(200)).body;
    expect(home).toMatchObject({ status: 'rejected', statusNote: 'The licence photo does not match the number.' });
    expect((await onboarding(r)).editable).toBe(true);
    await http().put('/v1/riders/me/kyc/driving-licence').set(r.headers).send({ number: 'AP26 2019 0054321' }).expect(200);
    await http().post('/v1/riders/me/submit').set(r.headers).expect(200);

    const approved = (await http().post(`/v1/ops/riders/${r.user.id}/approve`).set(ops).send({}).expect(200)).body;
    expect(approved).toMatchObject({ status: 'approved', statusNote: null, decidedAt: expect.any(String) });
    await http().post(`/v1/ops/riders/${r.user.id}/approve`).set(ops).send({}).expect(409); // already approved
    expect((await audit(r.user.id)).map((a) => a.action)).toEqual(expect.arrayContaining(['rider.submitted', 'rider.rejected', 'rider.approved']));
    await goOnline(r).expect(200);

    // Support can look but not decide.
    const support = await fake.signIn('9876511003', 'consumer');
    await http().post(`/v1/ops/riders/${r.user.id}/suspend`).set(support.headers).send({ reason: 'Not allowed for this role' }).expect(403);
  });

  it('ops pause a rider: they go offline and cannot come back online until the pause is lifted', async () => {
    const r = await fake.signIn('9876511004', 'rider');
    await fillAll(r);
    await http().post('/v1/riders/me/submit').set(r.headers).expect(200);
    await http().post(`/v1/ops/riders/${r.user.id}/approve`).set(ops).send({}).expect(200);
    await goOnline(r).expect(200);

    await http().post(`/v1/ops/riders/${r.user.id}/suspend`).set(ops).send({ reason: 'Three customer complaints this week.' }).expect(200);
    const home = (await http().get('/v1/riders/me').set(r.headers).expect(200)).body;
    expect(home).toMatchObject({ status: 'suspended', online: false, statusNote: 'Three customer complaints this week.' });
    const refused = (await goOnline(r).expect(403)).body.error;
    expect(refused).toMatchObject({ code: 'RIDER_NOT_APPROVED', details: { status: 'suspended' } });
    expect(refused.message).toContain('paused');

    await http().post(`/v1/ops/riders/${r.user.id}/approve`).set(ops).send({ note: 'Spoke to the rider' }).expect(200);
    await goOnline(r).expect(200);
    await http().put('/v1/riders/me/status').set(r.headers).send({ online: false }).expect(200);
    expect((await audit(r.user.id)).map((a) => a.action)).toEqual(expect.arrayContaining(['rider.suspended']));
  });

  it('a cycle needs no number plate or driving licence', async () => {
    const r = await fake.signIn('9876511005', 'rider');
    await fillAll(r, 'cycle');
    const v = await onboarding(r);
    expect(v).toMatchObject({ vehicle: 'cycle', vehicleNumber: null });
    expect(v.steps.every((s: { done: boolean }) => s.done)).toBe(true);
    await http().post('/v1/riders/me/submit').set(r.headers).expect(200);
  });
});
