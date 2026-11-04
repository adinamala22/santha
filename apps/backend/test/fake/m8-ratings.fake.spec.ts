/**
 * Ratings & reviews end to end (fake mode). PRD: ratings for merchant and rider after delivery
 * (verified purchase only), store page with rating distribution, discovery filter "rating 4+",
 * ranking by rating, moderation, store replies.
 *
 * Covers: GET /orders/{id}/rating; the rating reaching feed, search and store cards through the
 * search index (rating.submitted → reindex); minRating on /feed and /search; GET /stores/{id}/reviews
 * (summary + distribution); hidden reviews leave the rating (rating.moderated → reindex); merchant
 * summary; error paths.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { FakeSinks } from '../../src/infra/fake/fake-sinks';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
type Customer = Session & { addressId: string };
type Card = { id: string; rating: number | null; ratingCount: number };
let seq = 0;
const key = () => `ratings-key-${Date.now()}-${++seq}`;

describe('Ratings & reviews (fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let ops: Record<string, string>;
  let staffId: string;
  const http = () => fake.http();

  async function customer(phone: string): Promise<Customer> {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }

  async function order(c: Customer, deliver = true) {
    const items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items as Array<{ name: string; id: string; variants: Array<{ id: string }> }>;
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 2 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: 'online' }).expect(201)).body;
    await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    if (!deliver) return o as { id: string };
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'self', staffId }).expect(200);
    await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(200);
    const d = ((await http().get('/v1/merchants/me/deliveries').set(owner.headers).expect(200)).body.items as Array<{ orderId: string; staffLink: string }>).find((x) => x.orderId === o.id)!;
    const token = d.staffLink.split('/d/')[1]!;
    await http().post(`/v1/staff-jobs/${token}/picked-up`).expect(200);
    const otp = (await http().get(`/v1/orders/${o.id}/tracking`).set(c.headers).expect(200)).body.deliveryOtp as string;
    await http().post(`/v1/staff-jobs/${token}/delivered`).send({ otp }).expect(200);
    return o as { id: string };
  }

  const at = `lat=${centre.lat}&lng=${centre.lng}`;
  const feedCard = async (extra = ''): Promise<Card | undefined> =>
    ((await http().get(`/v1/feed?${at}&tab=stores${extra}`).expect(200)).body.stores as Card[]).find((s) => s.id === kirana.id);
  const searchCard = async (extra = ''): Promise<Card | undefined> =>
    ((await http().get(`/v1/search?${at}&q=atta${extra}`).expect(200)).body.groups as Array<{ store: Card }>).map((g) => g.store).find((s) => s.id === kirana.id);

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    const me = (await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200)).body;
    staffId = me.staff[0].id;
    ops = (await fake.opsSignIn()).headers;
  }, 60_000);
  afterAll(() => fake?.close());

  it('a new store is unrated: no stars on its card, left out of "4★ and above", empty summary', async () => {
    expect(await feedCard()).toMatchObject({ rating: null, ratingCount: 0 });
    expect(await feedCard('&minRating=4')).toBeUndefined();
    const reviews = (await http().get(`/v1/stores/${kirana.id}/reviews`).expect(200)).body;
    expect(reviews).toEqual({ summary: { avg: null, count: 0, distribution: [0, 0, 0, 0, 0] }, items: [] });
  });

  it('rating only after delivery, only by the customer; GET /orders/{id}/rating says whether it is rated', async () => {
    const c = await customer('9876502101');
    const open = await order(c, false);
    expect((await http().post(`/v1/orders/${open.id}/rating`).set(c.headers).send({ storeStars: 5 }).expect(409)).body.error.code).toBe('INVALID_STATE');
    const o = await order(c);
    expect((await http().get(`/v1/orders/${o.id}/rating`).set(c.headers).expect(200)).body).toEqual({ rating: null });
    const stranger = await customer('9876502102');
    await http().get(`/v1/orders/${o.id}/rating`).set(stranger.headers).expect(404);
    await http().post(`/v1/orders/${o.id}/rating`).set(stranger.headers).send({ storeStars: 1 }).expect(404);
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 6 }).expect(400);
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 5, comment: '  Fresh atta, quick delivery  ' }).expect(201);
    const mine = (await http().get(`/v1/orders/${o.id}/rating`).set(c.headers).expect(200)).body.rating;
    expect(mine).toMatchObject({ orderId: o.id, storeStars: 5, riderStars: null, comment: 'Fresh atta, quick delivery' });
    // The event carries the merchant so the search index rebuilds the store.
    const ev = fake.app.get(FakeSinks).events.find((e) => e.type === 'rating.submitted' && e.aggregate.id === o.id)!;
    expect(ev.payload).toMatchObject({ merchant_id: kirana.id, store_stars: 5, has_comment: true, flagged: false });
  });

  it('ratings reach the feed, search and the store page; "4★ and above" filters on them; reviews show the breakdown', async () => {
    const c = await customer('9876502201');
    const o = await order(c);
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 3 }).expect(201); // no comment
    // 5 (earlier test) + 3 → 4.0 from 2 ratings
    expect(await feedCard()).toMatchObject({ rating: 4, ratingCount: 2 });
    expect(await feedCard('&minRating=4')).toBeDefined();
    expect(await feedCard('&minRating=4.5')).toBeUndefined();
    expect(await searchCard('&minRating=4')).toMatchObject({ rating: 4, ratingCount: 2 });
    expect(await searchCard('&minRating=4.5')).toBeUndefined();
    await http().get(`/v1/feed?${at}&minRating=6`).expect(400);
    const page = (await http().get(`/v1/stores/${kirana.id}?${at}`).expect(200)).body;
    expect(page.store).toMatchObject({ rating: 4, ratingCount: 2 });

    const reviews = (await http().get(`/v1/stores/${kirana.id}/reviews`).expect(200)).body;
    expect(reviews.summary).toEqual({ avg: 4, count: 2, distribution: [0, 0, 1, 0, 1] });
    expect(reviews.items.map((r: { comment: string }) => r.comment)).toEqual(['Fresh atta, quick delivery']); // stars-only ratings are not listed
    const merchant = (await http().get('/v1/merchants/me/reviews').set(owner.headers).expect(200)).body;
    expect(merchant.summary).toEqual(reviews.summary);
  });

  it('a review hidden by ops leaves the rating everywhere; publishing it again brings it back', async () => {
    const c = await customer('9876502301');
    const o = await order(c);
    await http().post(`/v1/orders/${o.id}/rating`).set(c.headers).send({ storeStars: 1, comment: 'Call 9876543210 for cheaper atta' }).expect(201);
    // Held by the screen (contact details): stars count, the comment is not shown.
    expect((await http().get(`/v1/stores/${kirana.id}/reviews`).expect(200)).body.items).toHaveLength(1);
    expect((await feedCard())!.ratingCount).toBe(3);
    await http().post(`/v1/ops/reviews/${o.id}/moderate`).set(ops).send({ decision: 'hide' }).expect(200);
    expect(await feedCard()).toMatchObject({ rating: 4, ratingCount: 2 });
    expect((await http().get(`/v1/stores/${kirana.id}/reviews`).expect(200)).body.summary.distribution).toEqual([0, 0, 1, 0, 1]);
    expect(fake.app.get(FakeSinks).events.some((e) => e.type === 'rating.moderated' && e.aggregate.id === o.id)).toBe(true);
    await http().post(`/v1/ops/reviews/${o.id}/moderate`).set(ops).send({ decision: 'publish' }).expect(200);
    expect(await feedCard()).toMatchObject({ rating: 3, ratingCount: 3 });
  });

  it('reviews of an unknown store are 404; the list is capped', async () => {
    await http().get('/v1/stores/00000000-0000-4000-8000-000000000000/reviews').expect(404);
    await http().get('/v1/stores/not-a-uuid/reviews').expect(400);
    expect((await http().get(`/v1/stores/${kirana.id}/reviews?limit=1`).expect(200)).body.items).toHaveLength(1);
  });
});
