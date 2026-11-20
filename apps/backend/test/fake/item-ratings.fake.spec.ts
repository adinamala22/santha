/**
 * Item ratings (ADR-045), fake mode: after delivery a customer rates the order and, optionally, each item they received
 * (1 to 5 stars). Covers: item stars saved with the order rating and read back by GET /orders/{id}/rating; the average
 * and count on the store page items; a second customer moving the average; unrated items stay null; validation (an item
 * that is not on the order, the same item twice, 0 or 6 stars); a second rating of the same order is refused and
 * changes nothing; another customer cannot read the item stars.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
type Customer = Session & { addressId: string };
type StoreItem = { id: string; name: string; rating: number | null; ratingCount: number; variants: Array<{ id: string }> };
let seq = 0;
const key = () => `item-ratings-key-${Date.now()}-${++seq}`;

describe('Item ratings (fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let staffId: string;
  const http = () => fake.http();

  async function customer(phone: string): Promise<Customer> {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }
  const storeItems = async () => (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items as StoreItem[];
  const named = async (name: string) => (await storeItems()).find((x) => x.name === name)!;

  /** A delivered order of two items (atta and rice). */
  async function delivered(c: Customer) {
    const atta = await named('Annapoorna Chakki Atta');
    const rice = await named('Annapoorna Basmati Rice');
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [
      { itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 1 },
      { itemId: rice.id, variantId: rice.variants[0]!.id, quantity: 1 },
    ] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'online' }).expect(201)).body;
    await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'self', staffId }).expect(200);
    await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(200);
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; staffLink: string }>).find((x) => x.orderId === o.id)!;
    const token = d.staffLink.split('/d/')[1]!;
    await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(200);
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp as string;
    await http().post(`/v1/staff-jobs/${token}/delivered`).send({ otp }).expect(200);
    return { id: o.id as string, atta, rice };
  }

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    staffId = me.staff[0].id;
  }, 60_000);
  afterAll(() => fake?.close());

  it('items start unrated on the store page', async () => {
    for (const i of await storeItems()) expect(i).toMatchObject({ rating: null, ratingCount: 0 });
  });

  it('item stars are saved with the order rating and read back', async () => {
    const c = await customer('9876503101');
    const o = await delivered(c);
    const res = await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 5, itemStars: [{ itemId: o.atta.id, stars: 4 }, { itemId: o.rice.id, stars: 5 }] }).expect(201);
    expect(res.body.itemStars).toEqual(expect.arrayContaining([{ itemId: o.atta.id, stars: 4 }, { itemId: o.rice.id, stars: 5 }]));
    const mine = (await http().get(`/v1/orders/${o.id}/rating`).set(c.headers).expect(200)).body.rating;
    expect(mine.itemStars).toHaveLength(2);
    expect(mine.itemStars).toEqual(expect.arrayContaining([{ itemId: o.atta.id, stars: 4 }, { itemId: o.rice.id, stars: 5 }]));
  });

  it('the store page shows each item\'s average and count; a second customer moves the average; unrated items stay null', async () => {
    const atta = await named('Annapoorna Chakki Atta');
    const rice = await named('Annapoorna Basmati Rice');
    expect(atta).toMatchObject({ rating: 4, ratingCount: 1 });
    expect(rice).toMatchObject({ rating: 5, ratingCount: 1 });
    const c = await customer('9876503102');
    const o = await delivered(c);
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 4, itemStars: [{ itemId: o.atta.id, stars: 1 }] }).expect(201); // rice not rated
    expect(await named('Annapoorna Chakki Atta')).toMatchObject({ rating: 2.5, ratingCount: 2 });
    expect(await named('Annapoorna Basmati Rice')).toMatchObject({ rating: 5, ratingCount: 1 });
    const other = (await storeItems()).find((x) => x.name !== 'Annapoorna Chakki Atta' && x.name !== 'Annapoorna Basmati Rice')!;
    expect(other).toMatchObject({ rating: null, ratingCount: 0 });
  });

  it('the store owner sees every rated item with its average and count (GET /merchants/me/reviews)', async () => {
    const atta = await named('Annapoorna Chakki Atta');
    const rice = await named('Annapoorna Basmati Rice');
    const body = (await http().get('/v1/merchants/me/reviews').set(owner.headers).expect(200)).body;
    const by = new Map((body.itemRatings as Array<{ itemId: string; avg: number; count: number }>).map((r) => [r.itemId, r]));
    expect(by.get(atta.id)).toEqual({ itemId: atta.id, avg: 2.5, count: 2 });
    expect(by.get(rice.id)).toEqual({ itemId: rice.id, avg: 5, count: 1 });
    expect(body.itemRatings.length).toBe(2); // only items somebody rated
    // Customers and strangers cannot read it.
    const c = await customer('9876503108');
    await http().get('/v1/merchants/me/reviews').set(c.headers).expect(403);
  });

  it('item stars are optional: a rating with no itemStars still works and has none', async () => {
    const c = await customer('9876503103');
    const o = await delivered(c);
    const res = await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 3 }).expect(201);
    expect(res.body.itemStars).toEqual([]);
  });

  it('refuses an item that is not on the order, the same item twice, and stars outside 1 to 5', async () => {
    const c = await customer('9876503104');
    const o = await delivered(c);
    const stranger = (await storeItems()).find((x) => x.id !== o.atta.id && x.id !== o.rice.id)!;
    for (const itemStars of [[{ itemId: stranger.id, stars: 5 }], [{ itemId: o.atta.id, stars: 5 }, { itemId: o.atta.id, stars: 4 }], [{ itemId: o.atta.id, stars: 0 }], [{ itemId: o.atta.id, stars: 6 }]]) {
      const r = await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 5, itemStars }).expect(400);
      expect(r.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect((await http().get(`/v1/orders/${o.id}/rating`).set(c.headers).expect(200)).body.rating).toBeNull(); // nothing was saved
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 5, itemStars: [{ itemId: o.atta.id, stars: 5 }] }).expect(201);
  });

  it('a second rating of the same order is refused and does not change the item stars', async () => {
    const c = await customer('9876503105');
    const o = await delivered(c);
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 5, itemStars: [{ itemId: o.rice.id, stars: 5 }] }).expect(201);
    const before = await named('Annapoorna Basmati Rice');
    const again = await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 1, itemStars: [{ itemId: o.rice.id, stars: 1 }] }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_EXISTS');
    expect(await named('Annapoorna Basmati Rice')).toMatchObject({ rating: before.rating, ratingCount: before.ratingCount });
  });

  it('another customer cannot read or write the item stars of this order', async () => {
    const c = await customer('9876503106');
    const o = await delivered(c);
    const stranger = await customer('9876503107');
    await http().get(`/v1/orders/${o.id}/rating`).set(stranger.headers).expect(404);
    await http().post(`/v1/orders/${o.id}/rating`).set(stranger.headers).send({ storeStars: 5, itemStars: [{ itemId: o.atta.id, stars: 5 }] }).expect(404);
  });
});
