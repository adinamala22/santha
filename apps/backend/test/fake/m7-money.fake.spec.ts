/**
 * M7 acceptance (fake mode): money closes.
 *
 * BUILD-PLAN M7 acceptance:
 *  - settlement for delivered orders reconciles to the paisa (payout lines recomputed independently here;
 *    captured payments matched to the aggregator report)
 *  - ≥ 80% of the seeded issue scenarios auto-resolve
 *  - four-eyes is enforced above the threshold
 *  - statements download with the GST lines
 * Plus: disputes within 48 h credited in the next payout, ratings feed the rider score, issue windows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { MockPaymentsProvider, PaymentsProvider } from '../../src/infra/providers/payments/payments.provider';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / 111_195, lng: from.lng });
type Item = { id: string; name: string; variants: Array<{ id: string; pricePaise: number }> };
type Customer = Session & { addressId: string };
// API views read loosely in this test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let seq = 0;
const key = () => `m7-key-${Date.now()}-${++seq}`;
const IST = 330 * 60_000;
const istDate = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

describe('M7 · settlements, refunds, issues, disputes (fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let rider: Session;
  let ops: Record<string, string>;
  let items: Item[];
  let store: { lat: number; lng: number };
  let staffId: string;
  let zone: string;
  const http = () => fake.http();
  const now = async () => new Date((await http().get('/v1/dev/clock').expect(200)).body.now as string);
  const advance = (minutes: number) => http().post('/v1/dev/clock').send({ hours: minutes / 60 }).expect(200);

  async function customer(phone: string): Promise<Customer> {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }

  /** Places an order (2 lines) and delivers it — by staff (self) or by the rider. Returns the order view. */
  async function delivered(c: Customer, opts: { method?: 'online' | 'cod'; mode?: 'self' | 'rider'; atta?: number; lateMin?: number } = {}) {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    const rice = items.find((x) => x.name === 'Annapoorna Basmati Rice')!;
    const lines = [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: opts.atta ?? 2 }, { itemId: rice.id, variantId: rice.variants[0]!.id, quantity: 1 }];
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const method = opts.method ?? 'online';
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method }).expect(201)).body;
    if (method === 'online') await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    const mode = opts.mode ?? 'self';
    if (mode === 'rider') await http().post('/v1/riders/me/location').set(rider.headers).send(north(store, 300)).expect(204);
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send(mode === 'self' ? { fulfilmentMode: 'self', staffId } : { fulfilmentMode: 'rider' }).expect(200);
    await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(200);
    if (opts.lateMin) await advance(opts.lateMin + 60);
    const otp = async () => (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp as string;
    if (mode === 'self') {
      const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; staffLink: string }>).find((x) => x.orderId === o.id)!;
      const token = d.staffLink.split('/d/')[1]!;
      await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(200);
      const due = (await http().get(`/v1/staff-jobs/${token}`).expect(200)).body.codDuePaise as number;
      const code = await otp();
      await http().post(`/v1/staff-jobs/${token}/delivered`).send({ otp: code, ...(due ? { codCollectedPaise: due } : {}) }).expect(200);
    } else {
      await http().post('/v1/riders/me/location').set(rider.headers).send(north(store, 300)).expect(204);
      const offer = (await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.offer;
      const job = (await http().post(`/v1/offers/${offer.id}/accept`).set(rider.headers).expect(200)).body;
      const pickup = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; pickupCode: string }>).find((x) => x.orderId === o.id)!.pickupCode;
      await http().post(`/v1/jobs/${job.id}/picked-up`).set(rider.headers).send({ pickupCode: pickup }).expect(200);
      const code = await otp();
      await http().post(`/v1/jobs/${job.id}/delivered`).set(rider.headers).send({ otp: code, ...(job.codDuePaise ? { codCollectedPaise: job.codDuePaise } : {}) }).expect(200);
    }
    return (await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body as {
      id: string;
      code: string;
      state: string;
      totalPaise: number;
      lines: Array<{ variantId: string; linePaise: number; name: string }>;
      bill: { fees: Array<{ code: string; amountPaise: number }> };
    };
  }

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    store = me.merchant.location;
    zone = me.microMarket.id;
    staffId = me.staff[0].id;
    items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items;
    rider = await fake.signIn('9000000101', 'rider');
    await http().put('/v1/riders/me/status').set(rider.headers).send({ online: true, zones: [zone] }).expect(200);
    ops = (await fake.opsSignIn()).headers;
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: merchant and rider settlement reconcile to the paisa; statements carry the GST lines; payments reconcile', async () => {
    const day = istDate(await now());
    const c = await customer('9876500901');
    const selfCod = await delivered(c, { method: 'cod', mode: 'self' });
    const riderOnline = await delivered(c, { method: 'online', mode: 'rider' });

    const run = (await http().post('/v1/ops/settlements/run').set(ops).send({ kind: 'merchant', date: day }).expect(201)).body;
    expect(run).toMatchObject({ kind: 'merchant', status: 'completed' });
    // Idempotent: the same period returns the same run.
    expect((await http().post('/v1/ops/settlements/run').set(ops).send({ kind: 'merchant', date: day }).expect(201)).body.id).toBe(run.id);
    const payouts = (await http().get(`/v1/ops/settlements/${run.id}/payouts`).set(ops).expect(200)).body.items as Array<Row>;
    const p = payouts.find((x) => x.partyName === 'Ramesh Stores')!;

    // Independent recomputation of every line from the orders (rates: 6% self / 9% rider, 18% GST, 0.5% TCS, 0.1% TDS).
    const r = (n: number, pct: number) => Math.round((n * pct) / 100);
    const expectLine = (o: typeof selfCod, mode: 'self' | 'rider', cashWithStore: number) => {
      const items = o.lines.reduce((s, l) => s + l.linePaise, 0);
      const fee = (code: string) => o.bill.fees.find((f) => f.code === code)?.amountPaise ?? 0;
      const commission = r(items, mode === 'self' ? 6 : 9);
      const gst = r(commission, 18);
      const credit = mode === 'self' ? fee('delivery') : 0;
      return items + fee('packaging') + credit - commission - gst - r(items, 0.5) - r(items, 0.1) - cashWithStore;
    };
    const lines = p.lines as Array<{ code: string; netPaise: number; mode: string }>;
    expect(lines.find((l) => l.code === selfCod.code)!.netPaise).toBe(expectLine(selfCod, 'self', selfCod.totalPaise));
    expect(lines.find((l) => l.code === riderOnline.code)!.netPaise).toBe(expectLine(riderOnline, 'rider', 0));
    expect(p.netPaise).toBe(lines.reduce((s, l) => s + l.netPaise, 0) + (p.totals.adjustmentsPaise as number));
    expect(p.totals.cgstPaise + p.totals.sgstPaise).toBe((p.lines as Array<{ commissionGstPaise: number }>).reduce((s, l) => s + l.commissionGstPaise, 0));
    expect(['transferred', 'on_hold']).toContain(p.status);

    // Statement: PDF with the commission tax invoice (CGST/SGST) and TCS/TDS; CSV with one row per order.
    const pdf = await http().get(`/v1/merchants/me/payouts/${p.id}/statement.pdf`).set(owner.headers).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('CGST 9%');
    expect(text).toContain('SGST 9%');
    // Parentheses are escaped inside PDF strings.
    expect(text).toContain('GST TCS');
    expect(text).toContain('s.52');
    expect(text).toContain('s.194-O');
    const csv = (await http().get(`/v1/merchants/me/payouts/${p.id}/statement.csv`).set(owner.headers).expect(200)).text;
    expect(csv.trim().split('\n')).toHaveLength(1 + lines.length);
    expect((await http().get('/v1/merchants/me/payouts').set(owner.headers).expect(200)).body.items[0].id).toBe(p.id);

    // Riders are weekly: settle the week that contains today (run dated next week).
    const nextWeek = istDate(new Date((await now()).getTime() + 7 * 86_400_000));
    const rr = (await http().post('/v1/ops/settlements/run').set(ops).send({ kind: 'rider_weekly', date: nextWeek }).expect(201)).body;
    const rp = ((await http().get(`/v1/ops/settlements/${rr.id}/payouts`).set(ops).expect(200)).body.items as Array<Row>).find((x) => x.partyName === 'Demo Rider 1')!;
    const earnings = (await http().get('/v1/riders/me/earnings').set(rider.headers).expect(200)).body;
    expect(rp.totals.earnedPaise).toBe(earnings.totalPaise);
    expect(rp.netPaise).toBe(rp.totals.earnedPaise - rp.totals.cashHeldPaise);
    expect((await http().get('/v1/riders/me/payouts').set(rider.headers).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(rp.id);

    // Reconciliation: captured payments match the aggregator report to the paisa; a short-paid one is queued.
    expect((await http().post('/v1/ops/recon/run').set(ops).send({ date: day }).expect(200)).body).toEqual({ matched: 1, exceptions: 0 });
    const mock = fake.app.get(PaymentsProvider) as MockPaymentsProvider;
    const intent = ((await http().get(`/v1/ops/orders/${riderOnline.id}`).set(ops).expect(200)).body.payment) as { providerPaymentId: string; amountPaise: number };
    mock.report = [{ providerPaymentId: intent.providerPaymentId, amountPaise: intent.amountPaise - 100, feePaise: 0 }];
    const yesterday = istDate(new Date((await now()).getTime()));
    expect((await http().post('/v1/ops/recon/run').set(ops).send({ date: yesterday }).expect(200)).body.exceptions).toBe(1);
    mock.report = null;
    const ex = (await http().get('/v1/ops/recon').set(ops).expect(200)).body.items[0];
    expect(ex).toMatchObject({ kind: 'amount_mismatch', expectedPaise: intent.amountPaise, reportedPaise: intent.amountPaise - 100 });
    await http().post(`/v1/ops/recon/${ex.id}/resolve`).set(ops).send({ note: 'Bank fee adjustment confirmed' }).expect(200);
    const csvRun = (await http().get(`/v1/ops/settlements/${run.id}/payouts.csv`).set(ops).expect(200)).text;
    expect(csvRun).toContain('Ramesh Stores');
  });

  it('ACCEPTANCE: at least 80% of seeded issue scenarios auto-resolve (small trusted claims refunded to the wallet at once)', async () => {
    const results: string[] = [];
    // Five customers, two scenarios each (no one trips the "frequent issues" flag).
    const scenarios: Array<{ phone: string; type: string; pick?: 'atta' | 'rice' | 'both'; late?: number; big?: boolean }> = [
      { phone: '9876500911', type: 'missing_item', pick: 'rice' },
      { phone: '9876500911', type: 'damaged', pick: 'atta' },
      { phone: '9876500912', type: 'wrong_item', pick: 'rice' },
      { phone: '9876500912', type: 'quality', pick: 'atta' },
      { phone: '9876500913', type: 'missing_item', pick: 'atta' },
      { phone: '9876500913', type: 'late', late: 40 },
      { phone: '9876500914', type: 'damaged', pick: 'rice' },
      { phone: '9876500914', type: 'quality', pick: 'rice' },
      { phone: '9876500915', type: 'not_delivered' },
      { phone: '9876500915', type: 'damaged', pick: 'both', big: true },
    ];
    const customers = new Map<string, Customer>();
    for (const s of scenarios) {
      const c = customers.get(s.phone) ?? (await customer(s.phone));
      customers.set(s.phone, c);
      const o = await delivered(c, { lateMin: s.late, atta: s.big ? 25 : 2 });
      const atta = o.lines.find((l) => l.name === 'Annapoorna Chakki Atta')!.variantId;
      const rice = o.lines.find((l) => l.name === 'Annapoorna Basmati Rice')!.variantId;
      const variantIds = s.pick === 'atta' ? [atta] : s.pick === 'rice' ? [rice] : s.pick === 'both' ? [atta, rice] : undefined;
      const before = (await http().get('/v1/wallet').set(c.headers).expect(200)).body.balancePaise as number;
      const issue = (await http().post(`/v1/orders/${o.id}/issues`).set(c.headers).send({ type: s.type, variantIds, description: 'Seeded scenario' }).expect(201)).body;
      results.push(issue.status);
      if (issue.status === 'auto_resolved') {
        expect(issue.refundDestination).toBe('wallet');
        expect((await http().get('/v1/wallet').set(c.headers).expect(200)).body.balancePaise).toBe(before + issue.refundPaise);
        expect((await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body.refundedPaise).toBe(issue.refundPaise);
      }
    }
    const auto = results.filter((s) => s === 'auto_resolved').length;
    expect(auto / results.length).toBeGreaterThanOrEqual(0.8);
    expect(results.filter((s) => s === 'pending_review')).toHaveLength(2); // not delivered, and the big claim
    const open = (await http().get('/v1/ops/issues?status=open').set(ops).expect(200)).body.items as Array<{ type: string; trustScore: number }>;
    expect(open.map((i) => i.type).sort()).toEqual(['damaged', 'not_delivered']);
  });

  it('ACCEPTANCE: four-eyes above ₹1,000 — the same person cannot approve twice; a second approver completes it', async () => {
    const pending = (await http().get('/v1/ops/refunds?status=open').set(ops).expect(200)).body.items as Array<{ id: string; amountPaise: number; reason: string; userId: string }>;
    const big = pending.find((r) => r.amountPaise > 100_000)!;
    expect(big).toBeDefined();
    const first = (await http().post(`/v1/ops/refunds/${big.id}/approve`).set(ops).expect(200)).body;
    expect(first).toMatchObject({ status: 'awaiting_second', needsSecondApproval: true });
    expect((await http().post(`/v1/ops/refunds/${big.id}/approve`).set(ops).expect(409)).body.error.code).toBe('FOUR_EYES_REQUIRED');
    // An ops agent (not finance) cannot approve above ₹2,000.
    const agent = (await fake.opsSignIn('ops@santha.local')).headers;
    if (big.amountPaise > 200_000) expect((await http().post(`/v1/ops/refunds/${big.id}/approve`).set(agent).expect(403)).body.error.code).toBe('APPROVAL_LIMIT');
    const finance = (await fake.opsSignIn('finance@santha.local')).headers;
    const done = (await http().post(`/v1/ops/refunds/${big.id}/approve`).set(finance).expect(200)).body;
    expect(done).toMatchObject({ status: 'processed' });
    expect(done.approvals).toHaveLength(2);
    const audit = (await http().get(`/v1/ops/audit?entity=refund&entityId=${big.id}`).set(ops).expect(200)).body.items.map((x: { action: string }) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['refund.first_approval', 'refund.approved']));
    // The issue follows the refund.
    const issues = (await http().get('/v1/ops/issues').set(ops).expect(200)).body.items as Array<{ type: string; status: string; claimedPaise: number }>;
    expect(issues.find((i) => i.type === 'damaged' && i.claimedPaise > 100_000)!.status).toBe('approved');

    // A small manual one is rejected with a note (not_delivered).
    const nd = (await http().get('/v1/ops/refunds?status=open').set(ops).expect(200)).body.items[0];
    await http().post(`/v1/ops/refunds/${nd.id}/reject`).set(ops).send({ note: 'Rider photo shows delivery at the door' }).expect(200);
    expect((await http().get('/v1/ops/issues').set(ops).expect(200)).body.items.find((i: { type: string }) => i.type === 'not_delivered').status).toBe('rejected');
  });

  it('a store disputes a refund charged to it within 48 h; accepted disputes are credited in the next payout', async () => {
    const charged = (await http().get('/v1/merchants/me/refunds').set(owner.headers).expect(200)).body.items as Array<{ id: string; amountPaise: number; disputable: boolean; liability: string }>;
    const r = charged.find((x) => x.disputable && x.liability === 'merchant')!;
    const d = (await http().post('/v1/merchants/me/disputes').set(owner.headers).send({ refundId: r.id, reason: 'The customer received both items; CCTV at the counter shows packing.' }).expect(201)).body;
    expect(d.status).toBe('open');
    await http().post('/v1/merchants/me/disputes').set(owner.headers).send({ refundId: r.id, reason: 'The same refund disputed a second time.' }).expect(409);
    const resolved = (await http().post(`/v1/ops/disputes/${d.id}/resolve`).set(ops).send({ decision: 'accept', note: 'Evidence checked' }).expect(200)).body;
    expect(resolved).toMatchObject({ status: 'accepted', adjustmentPaise: r.amountPaise });

    await advance(24 * 60);
    const day = istDate(await now());
    const run = (await http().post('/v1/ops/settlements/run').set(ops).send({ kind: 'merchant', date: day }).expect(201)).body;
    const p = ((await http().get(`/v1/ops/settlements/${run.id}/payouts`).set(ops).expect(200)).body.items as Array<Row>).find((x) => x.partyName === 'Ramesh Stores')!;
    expect(p.totals.disputeCreditsPaise).toBe(r.amountPaise);
    expect((await http().get('/v1/merchants/me/disputes').set(owner.headers).expect(200)).body.items[0].settledInPayout).toBe(p.id);

    // After 48 h the other refunds can no longer be disputed.
    await advance(48 * 60);
    const later = (await http().get('/v1/merchants/me/refunds').set(owner.headers).expect(200)).body.items as Array<{ id: string; disputable: boolean }>;
    const old = later.find((x) => x.id !== r.id)!;
    expect(old.disputable).toBe(false);
    expect((await http().post('/v1/merchants/me/disputes').set(owner.headers).send({ refundId: old.id, reason: 'Too late to dispute this refund now.' }).expect(422)).body.error.code).toBe('DISPUTE_WINDOW_CLOSED');
  });

  it('ratings: once per delivered order; the rider score follows', async () => {
    const c = await customer('9876500921');
    const o = await delivered(c, { mode: 'rider' });
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 5, riderStars: 3, comment: 'Quick, but the bag was torn' }).expect(201);
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 4 }).expect(409);
    expect((await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.rating).toBe(3);
  });

  it('issue windows and rules: retail closes after 24 h; returns are for fashion only; one report per problem', async () => {
    const c = await customer('9876500931');
    const o = await delivered(c);
    const rice = o.lines.find((l) => l.name === 'Annapoorna Basmati Rice')!.variantId;
    expect((await http().post(`/v1/orders/${o.id}/issues`).set(c.headers).send({ type: 'return_request', variantIds: [rice] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    await http().post(`/v1/orders/${o.id}/issues`).set(c.headers).send({ type: 'missing_item', variantIds: [rice] }).expect(201);
    await http().post(`/v1/orders/${o.id}/issues`).set(c.headers).send({ type: 'missing_item', variantIds: [rice] }).expect(409);
    await advance(25 * 60);
    expect((await http().post(`/v1/orders/${o.id}/issues`).set(c.headers).send({ type: 'damaged', variantIds: [rice] }).expect(422)).body.error.code).toBe('ISSUE_WINDOW_CLOSED');
    const other = await customer('9876500932');
    await http().post(`/v1/orders/${o.id}/issues`).set(other.headers).send({ type: 'late' }).expect(404);
  });
});
