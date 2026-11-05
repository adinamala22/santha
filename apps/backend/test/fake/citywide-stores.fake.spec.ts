/**
 * City-wide stores and the Open switch (ADR-021, ADR-022, fake mode):
 * - the home feed lists every live store of the city, all deliverable; beyond a store's 5 km radius the
 *   card says so (beyondRadius) and the bill adds the extra delivery charge;
 * - checkout ignores area borders: any address of the city can order;
 * - "Deliver anywhere": the store delivers its beyond-radius orders itself (not for fashion);
 * - the partner's Open switch outside the hours opens the store now, until the next scheduled close;
 *   turning it off closes it; new hours end the override;
 * - ops set a store's hours from the console (audited, reindexed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { FakeSinks } from '../../src/infra/fake/fake-sinks';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!; // Dargamitta, 5 km radius
const centre = (slug: string) => SEED_MICRO_MARKETS.find((m) => m.slug === slug)!.centre;
const at = (p: { lat: number; lng: number }) => `lat=${p.lat}&lng=${p.lng}`;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const hoursOf = (range: Array<{ open: string; close: string }>) => Object.fromEntries(DAYS.map((d) => [d, range]));
const closedAllWeek = hoursOf([]);
const allDay = hoursOf([{ open: '00:00', close: '23:59' }]);

interface Card {
  id: string;
  name: string;
  deliverable: boolean;
  beyondRadius: boolean;
  deliversAnywhere: boolean;
  open: boolean;
  closesAt: string | null;
}

describe('City-wide stores and the Open switch (fake mode)', () => {
  let fake: FakeApp;
  let ops: Session;
  let owner: Session;
  const http = () => fake.http();
  const card = async (where: { lat: number; lng: number }, id = kirana.id) =>
    ((await http().get(`/v1/feed?${at(where)}&tab=stores`).expect(200)).body.stores as Card[]).find((s) => s.id === id);

  beforeAll(async () => {
    fake = await bootFakeApp();
    ops = await fake.opsSignIn();
    owner = await fake.signIn(kirana.ownerPhone, 'merchant');
    await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: allDay }).expect(200);
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: every live store of the city is listed and delivers; beyond the 5 km radius it is marked for the extra charge', async () => {
    expect(SEED_MERCHANTS.every((m) => m.radiusM === 5000)).toBe(true); // every store reset to 5 km (ADR-022)
    const live = SEED_MERCHANTS.filter((m) => m.status === 'live' && m.type === 'retail');
    const stores = (await http().get(`/v1/feed?${at(centre('vedayapalem'))}&tab=stores`).expect(200)).body.stores as Card[];
    expect(stores.map((s) => s.name).sort()).toEqual(live.map((m) => m.name).sort());
    expect(stores.every((s) => s.deliverable)).toBe(true);
    expect(stores.find((s) => s.id === kirana.id)).toMatchObject({ beyondRadius: true }); // ~5.3 km away
    // Its page names the store's own area and the extra charge for this address.
    const page = (await http().get(`/v1/stores/${kirana.id}?${at(centre('vedayapalem'))}`).expect(200)).body;
    expect(page).toMatchObject({
      microMarket: { slug: 'dargamitta' },
      deliversHere: true,
      notDeliveringReason: null,
      beyondRadiusSurchargePaise: 3000,
      store: { deliverable: true, beyondRadius: true },
    });
  });

  it('checkout: any address of the city can order; beyond the radius the bill has the extra delivery charge', async () => {
    const store = (await http().get(`/v1/stores/${kirana.id}?${at(centre('dargamitta'))}`).expect(200)).body;
    const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    const priceAt = async (phone: string, where: { lat: number; lng: number }) => {
      const s = await fake.signIn(phone, 'consumer');
      const a = (await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: '12, Main Road', location: where }).expect(201)).body;
      await http().put('/v1/cart').set(s.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 3 }] }).expect(200);
      return (await http().post('/v1/cart/price').set(s.headers).send({ addressId: a.id, when: { mode: 'asap' } }).expect(200)).body;
    };
    const magunta = await priceAt('9876521001', centre('magunta-layout')); // another area, within 5 km
    expect(magunta.problems).not.toContainEqual({ code: 'NOT_DELIVERABLE' });
    expect(magunta.placeable).toBe(true);
    expect(magunta.bill.fees.map((f: { code: string }) => f.code)).not.toContain('beyond_radius');
    const vedayapalem = await priceAt('9876521002', centre('vedayapalem')); // beyond 5 km
    expect(vedayapalem.problems).not.toContainEqual({ code: 'NOT_DELIVERABLE' });
    expect(vedayapalem.placeable).toBe(true);
    expect(vedayapalem.bill.fees).toContainEqual({ code: 'beyond_radius', amountPaise: 3000, waivedPaise: 0 });
  });

  it('"Deliver anywhere": not for fashion; the store delivers its beyond-radius orders itself and sees them flagged', async () => {
    const boutique = SEED_MERCHANTS.find((m) => m.type === 'fashion' && m.status === 'live')!;
    const fashion = await fake.signIn(boutique.ownerPhone, 'merchant');
    await http().patch('/v1/merchants/me').set(fashion.headers).send({ deliversAnywhere: true }).expect(400);

    const on = (await http().patch('/v1/merchants/me').set(owner.headers).send({ deliversAnywhere: true, defaultFulfilment: 'rider' }).expect(200)).body;
    expect(on.merchant.deliversAnywhere).toBe(true);
    expect(await card(centre('dargamitta'))).toMatchObject({ deliversAnywhere: true });

    const place = async (phone: string, where: { lat: number; lng: number }) => {
      const store = (await http().get(`/v1/stores/${kirana.id}?${at(where)}`).expect(200)).body;
      const atta = store.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
      const s = await fake.signIn(phone, 'consumer');
      const a = (await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: '12, Main Road', location: where }).expect(201)).body;
      const lines = [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 3 }];
      await http().put('/v1/cart').set(s.headers).send({ merchantId: kirana.id, replace: true, lines }).expect(200);
      const q = (await http().post('/v1/cart/price').set(s.headers).send({ addressId: a.id, when: { mode: 'asap' } }).expect(200)).body;
      const headers = { ...s.headers, 'Idempotency-Key': `cw-${phone}` };
      return (await http().post('/v1/orders').set(headers).send({ quoteId: q.quoteId, paymentMethod: 'cod' }).expect(201)).body;
    };
    const far = await place('9876521003', centre('vedayapalem'));
    const listed = (await http().get('/v1/merchants/me/orders?bucket=new').set(owner.headers).expect(200)).body.items as Array<{ id: string; beyondRadius: boolean }>;
    expect(listed.find((o) => o.id === far.id)).toMatchObject({ beyondRadius: true });
    await http().post(`/v1/orders/${far.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(400);
    const accepted = (await http().post(`/v1/orders/${far.id}/accept`).set(owner.headers).send({}).expect(200)).body;
    expect(accepted).toMatchObject({ fulfilmentMode: 'self', beyondRadius: true }); // not the store's usual rider

    // Within the radius the store's usual choice still applies.
    const near = await place('9876521004', centre('dargamitta'));
    const nearAccepted = (await http().post(`/v1/orders/${near.id}/accept`).set(owner.headers).send({}).expect(200)).body;
    expect(nearAccepted).toMatchObject({ fulfilmentMode: 'rider', beyondRadius: false });
    await http().patch('/v1/merchants/me').set(owner.headers).send({ deliversAnywhere: false, defaultFulfilment: 'self' }).expect(200);
  });

  it('the Open switch outside the hours opens the store until the next scheduled close; off closes it', async () => {
    const me = await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: closedAllWeek }).expect(200);
    expect(me.body.openNow).toMatchObject({ open: false });
    expect(await card(centre('dargamitta'))).toMatchObject({ open: false });

    const opened = (await http().put('/v1/merchants/me/availability').set(owner.headers).send({ open: true }).expect(200)).body;
    expect(opened.merchant).toMatchObject({ acceptingOrders: true, openUntil: expect.any(String) });
    expect(opened.openNow).toMatchObject({ open: true, closesAt: opened.merchant.openUntil });
    expect(await card(centre('dargamitta'))).toMatchObject({ open: true, closesAt: opened.merchant.openUntil });
    const events = fake.app.get(FakeSinks).events.filter((e) => e.type === 'merchant.availability_changed');
    expect(events.at(-1)?.payload).toMatchObject({ merchant_id: kirana.id, accepting_orders: true, open_until: opened.merchant.openUntil });

    const off = (await http().put('/v1/merchants/me/availability').set(owner.headers).send({ open: false }).expect(200)).body;
    expect(off.merchant).toMatchObject({ acceptingOrders: false, openUntil: null });
    expect(await card(centre('dargamitta'))).toMatchObject({ open: false });

    // On again, then new hours: the hours decide again.
    await http().put('/v1/merchants/me/availability').set(owner.headers).send({ open: true }).expect(200);
    const back = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: allDay }).expect(200)).body;
    expect(back.merchant.openUntil).toBeNull();
    expect(back.openNow.open).toBe(true);
  });

  it('ops set the hours (reason required, admin/ops only, audited); the feed follows', async () => {
    const put = (body: object, s: Session = ops) => http().put(`/v1/ops/merchants/${kirana.id}/hours`).set(s.headers).send(body);
    await put({ hours: closedAllWeek }).expect(400); // reason required
    await put({ hours: hoursOf([{ open: '21:00', close: '09:00' }]), reason: 'night shift' }).expect(400); // close before open
    await put({ hours: closedAllWeek, reason: 'test' }, owner).expect(403);

    const v = (await put({ hours: closedAllWeek, reason: 'Owner away this week' }).expect(200)).body;
    expect(v.merchant.hours.mon).toEqual([]);
    expect(v.openNow.open).toBe(false);
    expect(await card(centre('dargamitta'))).toMatchObject({ open: false });
    const audit = (await http().get(`/v1/ops/audit?entity=merchant&entityId=${kirana.id}`).set(ops.headers).expect(200)).body.items as Array<{ action: string; after: unknown }>;
    expect(audit[0]).toMatchObject({ action: 'hours_changed', after: { reason: 'Owner away this week' } });

    await put({ hours: allDay, reason: 'back' }).expect(200);
    expect(await card(centre('dargamitta'))).toMatchObject({ open: true });
  });
});
