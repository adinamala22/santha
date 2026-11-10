/**
 * Leave at the door (ADR-036), fake mode:
 *  - a saved address can carry the choice; it is the default for new orders to it;
 *  - checkout can override it either way; cash orders never leave anything at the door;
 *  - the rider's job says whether the customer is happy for the order to be left at the door.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / 111_195, lng: from.lng });
type StoreItem = { id: string; name: string; variants: Array<{ id: string }> };

let seq = 0;
const key = () => `lad-key-${Date.now()}-${++seq}`;

describe('Leave at the door (ADR-036, fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let rider: Session;
  let items: StoreItem[];
  let store: { lat: number; lng: number };
  let marketId: string;
  const http = () => fake.http();

  async function customer(phone: string, leaveAtDoor?: boolean) {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http()
      .post('/v1/me/addresses')
      .set(s.headers)
      .send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre, ...(leaveAtDoor === undefined ? {} : { leaveAtDoor }) })
      .expect(201);
    return { ...s, addressId: a.body.id as string, address: a.body };
  }
  async function quote(c: Session & { addressId: string }) {
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 3 }] }).expect(200);
    return (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
  }
  async function place(c: Session & { addressId: string }, method: 'online' | 'cod', extra: Record<string, unknown> = {}) {
    const q = await quote(c);
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method, ...extra }).expect(201)).body;
    if (method === 'online') await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    return o as { id: string; address: { leaveAtDoor?: boolean } };
  }
  async function jobFor(orderId: string) {
    await http().post(`/v1/orders/${orderId}/accept`).set(owner.headers).send({ fulfilmentMode: 'rider' }).expect(200);
    const offer = (await http().get('/v1/riders/me').set(rider.headers).expect(200)).body.offer;
    const job = (await http().post(`/v1/offers/${offer.id}/accept`).set(rider.headers).expect(200)).body;
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; pickupCode: string }>).find((x) => x.orderId === orderId)!;
    await http().post(`/v1/orders/${orderId}/ready`).set(owner.headers).expect(200);
    await http().post(`/v1/jobs/${job.id}/picked-up`).set(rider.headers).send({ pickupCode: d.pickupCode }).expect(200);
    return job as { id: string; drop: { leaveAtDoor: boolean } };
  }
  async function finish(jobId: string, orderId: string, c: Session, cash?: number) {
    const otp = (await http().get(`/v1/orders/${orderId}/tracking`).set(c.headers).expect(200)).body.deliveryOtp;
    await http()
      .post(`/v1/jobs/${jobId}/delivered`)
      .set(rider.headers)
      .send({ otp, ...(cash ? { codCollectedPaise: cash } : {}) })
      .expect(200);
  }

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    store = me.merchant.location;
    marketId = me.merchant.microMarketId ?? me.microMarket.id;
    items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items;
    rider = await fake.signIn('9000000101', 'rider');
    await http().put('/v1/riders/me/status').set(rider.headers).send({ online: true, zones: [marketId] }).expect(200);
    await http().post('/v1/riders/me/location').set(rider.headers).send(north(store, 300)).expect(204);
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: the saved choice is the default; the rider sees it on the job; checkout can override it', async () => {
    const c = await customer('9876501101', true);
    expect(c.address.leaveAtDoor).toBe(true);
    expect((await http().get('/v1/me/addresses').set(c.headers).expect(200)).body.items[0].leaveAtDoor).toBe(true);
    expect((await quote(c)).address.leaveAtDoor).toBe(true); // checkout shows the saved choice as the default

    // Default: left at the door, and the rider's job says so.
    const o = await place(c, 'online');
    expect(o.address.leaveAtDoor).toBe(true);
    const job = await jobFor(o.id);
    expect(job.drop.leaveAtDoor).toBe(true);
    expect((await http().get(`/v1/jobs/${job.id}`).set(rider.headers).expect(200)).body.drop.leaveAtDoor).toBe(true);
    await finish(job.id, o.id, c);

    // Turned off at checkout for this order only: the saved choice is untouched.
    const o2 = await place(c, 'online', { leaveAtDoor: false });
    expect(o2.address.leaveAtDoor).toBe(false);
    const job2 = await jobFor(o2.id);
    expect(job2.drop.leaveAtDoor).toBe(false);
    await finish(job2.id, o2.id, c);
    expect((await http().get('/v1/me/addresses').set(c.headers).expect(200)).body.items[0].leaveAtDoor).toBe(true);
  });

  it('off by default; turned on for one order at checkout; can be changed on the address', async () => {
    const c = await customer('9876501102');
    expect(c.address.leaveAtDoor).toBe(false);
    const o = await place(c, 'online', { leaveAtDoor: true });
    expect(o.address.leaveAtDoor).toBe(true);
    const job = await jobFor(o.id);
    expect(job.drop.leaveAtDoor).toBe(true);
    await finish(job.id, o.id, c);

    const patched = (await http().patch(`/v1/me/addresses/${c.addressId}`).set(c.headers).send({ leaveAtDoor: true }).expect(200)).body;
    expect(patched.leaveAtDoor).toBe(true);
    expect((await place(c, 'online')).address.leaveAtDoor).toBe(true);
  });

  it('cash orders are never left at the door, whatever was chosen', async () => {
    const c = await customer('9876501103', true);
    const o = await place(c, 'cod'); // saved choice on, paying cash
    expect(o.address.leaveAtDoor).toBe(false);
    const o2 = await place(c, 'cod', { leaveAtDoor: true }); // asked explicitly, still cash
    expect(o2.address.leaveAtDoor).toBe(false);
    const job = await jobFor(o.id);
    expect(job.drop.leaveAtDoor).toBe(false);
    await finish(job.id, o.id, c, (await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body.totalPaise);
  });
});
