/**
 * M8 acceptance (fake mode): trust & safety, DPDP artefacts, analytics, hardening.
 *
 * BUILD-PLAN M8: moderation queue with a classifier stub, ratings/reviews with moderation and store
 * replies, grievance workflow (officer clocks), DPDP consent records and data-principal requests, the
 * analytics export and reports (funnel, on-time, fill rate, contribution per order, merchant health,
 * rider utilisation), lead forms with honeypot + rate limit, public store pages, security headers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { GrowthService } from '../../src/modules/analytics-config/growth/growth.service';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
type Customer = Session & { addressId: string };
let seq = 0;
const key = () => `m8-key-${Date.now()}-${++seq}`;

describe('M8 · trust & safety, DPDP, analytics, launch (fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let ops: Record<string, string>;
  let staffId: string;
  let slug: string;
  const http = () => fake.http();

  async function customer(phone: string): Promise<Customer> {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }

  async function delivered(c: Customer, deliver = true) {
    const items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items as Array<{ name: string; id: string; variants: Array<{ id: string }> }>;
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 2 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'online' }).expect(201)).body;
    await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    if (!deliver) return o as { id: string; code: string };
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'self', staffId }).expect(200);
    await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(200);
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; staffLink: string }>).find((x) => x.orderId === o.id)!;
    const token = d.staffLink.split('/d/')[1]!;
    await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(200);
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp as string;
    await http().post(`/v1/staff-jobs/${token}/delivered`).send({ otp }).expect(200);
    return o as { id: string; code: string };
  }

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    staffId = me.staff[0].id;
    slug = me.merchant.slug ?? '';
    ops = (await fake.opsSignIn()).headers;
  }, 60_000);
  afterAll(() => fake?.close());

  it('lead forms: stored once, honeypot ignored, rate-limited per IP; ops follows up', async () => {
    await http().post('/v1/leads').send({ kind: 'store', name: 'Sri Rama Kirana', phone: '9876501001', area: 'Balaji Nagar', locale: 'te' }).expect(201);
    await http().post('/v1/leads').send({ kind: 'store', name: 'Sri Rama Kirana', phone: '9876501001' }).expect(201); // merged
    await http().post('/v1/leads').send({ kind: 'rider', name: 'Bot', phone: '9876501002', website: 'http://spam.example' }).expect(201);
    await http().post('/v1/leads').send({ kind: 'rider', name: 'Bad', phone: '12345' }).expect(400);
    const leads = (await http().get('/v1/ops/leads').set(ops).expect(200)).body.items as Array<{ id: string; name: string; phone: string; locale: string }>;
    expect(leads.map((l) => l.name)).toEqual(['Sri Rama Kirana']);
    expect(leads[0]).toMatchObject({ phone: '+919876501001', locale: 'te' });
    await http().patch(`/v1/ops/leads/${leads[0]!.id}`).set(ops).send({ status: 'contacted', note: 'Visit on Friday' }).expect(200);
    for (let i = 0; i < 5; i++) await http().post('/v1/leads').send({ kind: 'home_kitchen', name: `Kitchen ${i}`, phone: `98765020${10 + i}` });
    expect((await http().post('/v1/leads').send({ kind: 'home_kitchen', name: 'One more', phone: '9876502099' }).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('grievances: acknowledged within 48 h, resolved within a month; overdue is visible to ops', async () => {
    const c = await customer('9876501101');
    const g = (await http().post('/v1/me/grievances').set(c.headers).send({ category: 'refund', description: 'My refund for the damaged item has not come yet.' }).expect(201)).body;
    expect(new Date(g.ackDueAt).getTime() - new Date(g.createdAt).getTime()).toBe(48 * 3_600_000);
    expect(g).toMatchObject({ status: 'open', app: 'consumer', overdue: false });
    await http().post('/v1/dev/clock').send({ hours: 49 }).expect(200);
    const open = (await http().get('/v1/ops/grievances?status=open').set(ops).expect(200)).body.items as Array<{ id: string; overdue: boolean }>;
    expect(open.find((x) => x.id === g.id)!.overdue).toBe(true);
    await http().post(`/v1/ops/grievances/${g.id}/acknowledge`).set(ops).expect(200);
    const done = (await http().post(`/v1/ops/grievances/${g.id}/resolve`).set(ops).send({ resolution: 'Refund of ₹62 credited to the wallet on 3 Nov.' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'resolved' });
    expect((await http().get('/v1/me/grievances').set(c.headers).expect(200)).body.items[0].resolution).toContain('credited');
    const audit = (await http().get(`/v1/ops/audit?entity=grievance&entityId=${g.id}`).set(ops).expect(200)).body.items.map((x: { action: string }) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['grievance.acknowledged', 'grievance.resolved']));
  });

  it('DPDP consents: a ledger per purpose and notice version; terms and privacy cannot be withdrawn here', async () => {
    const c = await customer('9876501201');
    const before = (await http().get('/v1/me/consents').set(c.headers).expect(200)).body.items as Array<{ purpose: string; granted: boolean }>;
    expect(before.every((x) => !x.granted)).toBe(true);
    for (const purpose of ['terms', 'privacy', 'marketing']) await http().put('/v1/me/consents').set(c.headers).send({ purpose, granted: true }).expect(200);
    const after = (await http().put('/v1/me/consents').set(c.headers).send({ purpose: 'marketing', granted: false }).expect(200)).body.items as Array<{ purpose: string; granted: boolean; current: boolean }>;
    expect(after.find((x) => x.purpose === 'marketing')).toMatchObject({ granted: false, current: true });
    expect(after.find((x) => x.purpose === 'terms')).toMatchObject({ granted: true, current: true });
    await http().put('/v1/me/consents').set(c.headers).send({ purpose: 'terms', granted: false }).expect(400);
  });

  it('DPDP data requests: export at once; erasure waits for open orders, then anonymises and signs out', async () => {
    const c = await customer('9876501301');
    await delivered(c);
    const access = (await http().post('/v1/me/data-requests').set(c.headers).send({ type: 'access' }).expect(201)).body;
    expect(access).toMatchObject({ status: 'completed', exportReady: true });
    const file = await http().get(`/v1/me/data-requests/${access.id}/export`).set(c.headers).expect(200);
    const data = JSON.parse(file.text || (file.body as Buffer).toString());
    expect(data.account.phone).toBe('+919876501301');
    expect(data.orders).toHaveLength(1);
    expect(data.addresses).toHaveLength(1);

    const open = await delivered(c, false); // an order still in progress
    const erase = (await http().post('/v1/me/data-requests').set(c.headers).send({ type: 'erasure', details: 'Please delete my account' }).expect(201)).body;
    expect(erase.status).toBe('open');
    await http().post('/v1/me/data-requests').set(c.headers).send({ type: 'erasure' }).expect(409);
    await http().post(`/v1/ops/data-requests/${erase.id}/decide`).set(ops).send({ decision: 'complete', note: 'Verified by phone' }).expect(409);
    await http().post(`/v1/orders/${open.id}/cancel`).set(c.headers).send({ reason: 'changed_mind' }).expect(200);
    expect((await http().post(`/v1/ops/data-requests/${erase.id}/decide`).set(ops).send({ decision: 'complete', note: 'Verified by phone' }).expect(200)).body.status).toBe('completed');
    await http().get('/v1/me').set(c.headers).expect(401); // sessions revoked
    // The phone number is free again: signing in creates a fresh account.
    const again = await fake.signIn('9876501301', 'consumer');
    expect(again.user.id).not.toBe(c.user.id);
  });

  it('reviews: comments with contact details are held; ops publishes; the store replies; the public page shows published ones', async () => {
    const c = await customer('9876501401');
    const o1 = await delivered(c);
    const o2 = await delivered(c);
    await http().post(`/v1/orders/${o1.id}/rating`).set(c.headers).send({ storeStars: 5, comment: 'Very fresh atta, packed well' }).expect(201);
    await http().post(`/v1/orders/${o2.id}/rating`).set(c.headers).send({ storeStars: 2, comment: 'Call me on 9876543210 for bulk orders' }).expect(201);
    const flagged = (await http().get('/v1/ops/reviews').set(ops).expect(200)).body.items as Array<{ orderId: string; flagReason: string }>;
    expect(flagged.find((r) => r.orderId === o2.id)!.flagReason).toBe('contact_details');
    let mine = (await http().get('/v1/merchants/me/reviews').set(owner.headers).expect(200)).body.items as Array<{ orderId: string }>;
    expect(mine.map((r) => r.orderId)).not.toContain(o2.id);
    await http().post(`/v1/ops/reviews/${o2.id}/moderate`).set(ops).send({ decision: 'hide' }).expect(200);
    await http().post(`/v1/merchants/me/reviews/${o1.id}/reply`).set(owner.headers).send({ text: 'Thank you! See you again.' }).expect(200);
    await http().post(`/v1/merchants/me/reviews/${o1.id}/reply`).set(owner.headers).send({ text: 'Order on www.mystore.in next time' }).expect(400);
    mine = (await http().get('/v1/merchants/me/reviews').set(owner.headers).expect(200)).body.items;
    expect(mine.map((r) => r.orderId)).toContain(o1.id);

    expect(slug).toMatch(/^ramesh-stores-[0-9a-f]{4}$/);
    const page = (await http().get(`/v1/public/stores/${slug}`).expect(200)).body;
    expect(page).toMatchObject({ name: 'Ramesh Stores', area: 'Dargamitta' });
    expect(page.reviews.map((r: { comment: string }) => r.comment)).toEqual(['Very fresh atta, packed well']);
    expect(page.reviews[0].reply).toBe('Thank you! See you again.');
    expect(page.rating.count).toBe(1); // the hidden one does not count
    await http().get('/v1/public/stores/no-such-store').expect(404);
  });

  it('reports and the analytics export: funnel, on-time, fill rate, contribution, merchant health; ids only leave', async () => {
    const r = (await http().get('/v1/ops/reports').set(ops).expect(200)).body;
    expect(r.funnel.delivered).toBeGreaterThanOrEqual(3);
    expect(r.funnel.placed).toBeGreaterThanOrEqual(r.funnel.delivered);
    expect(r.fillRatePercent).toBeGreaterThan(0);
    expect(r.onTimePercent).not.toBeNull();
    expect(r.contribution.commissionPaise).toBeGreaterThan(0);
    expect(r.merchants.find((m: { name: string }) => m.name === 'Ramesh Stores')).toMatchObject({ acceptancePercent: 100 });
    const captured = fake.app.get(GrowthService).captured;
    expect(captured.map((e) => e.event)).toEqual(expect.arrayContaining(['order.placed', 'order.delivered', 'payment.captured']));
    expect(JSON.stringify(captured)).not.toMatch(/\+91\d{10}/); // no phone numbers in analytics
  });

  it('security headers on every API response', async () => {
    const res = await http().get('/v1/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
