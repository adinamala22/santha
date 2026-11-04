import { expect, test } from '@playwright/test';
import { API, appSignIn, LIVE, call, deliverBySelf, type Headers, newCustomer, openAllDay, placeCodOrder, SEED } from '../support/target';

/**
 * The core journey through the API, as the consumer and partner apps drive it (fake + live):
 * sign in → serviceable address → feed and search → cart and bill → COD order → store accepts with
 * self-delivery → staff delivers with the OTP → customer rates with a review (ADR-018) → the rating reaches
 * the feed, the "4★ & above" filter, the store's reviews and the public store page.
 */
test.describe.serial('journey: order → delivery → rating', () => {
  let owner: Headers;
  let restoreHours: (request: import('@playwright/test').APIRequestContext) => Promise<void>;
  let customer: Awaited<ReturnType<typeof newCustomer>>;
  let order: Awaited<ReturnType<typeof placeCodOrder>>;
  const at = `lat=${SEED.dargamitta.lat}&lng=${SEED.dargamitta.lng}`;

  test.beforeAll(async ({ request }) => {
    owner = await appSignIn(request, SEED.kirana.ownerPhone, 'merchant');
    restoreHours = await openAllDay(request, owner);
  });
  test.afterAll(async ({ request }) => {
    await restoreHours?.(request);
  });

  test('discovery: serviceable address, feed and grouped search show the kirana', async ({ request }) => {
    customer = await newCustomer(request);
    const s = await call(request, 'get', `/serviceability?${at}`);
    expect(s).toMatchObject({ serviceable: true, microMarket: { slug: 'dargamitta' } });
    const feed = await call(request, 'get', `/feed?${at}&tab=stores`);
    expect(feed.stores.map((x: { id: string }) => x.id)).toContain(SEED.kirana.id);
    const search = await call(request, 'get', `/search?${at}&q=atta`);
    expect(search.groups.some((g: { store: { id: string } }) => g.store.id === SEED.kirana.id)).toBe(true);
  });

  test('checkout: COD order is PLACED with a bill recomputed from its lines', async ({ request }) => {
    order = await placeCodOrder(request, customer);
    expect(order.state).toBe('PLACED');
    expect(order.totalPaise).toBeGreaterThan(0);
    const mine = await call(request, 'get', '/orders', { headers: customer.headers });
    expect(mine.items.map((o: { id: string }) => o.id)).toContain(order.id);
  });

  test('fulfilment: the store accepts with self-delivery; staff delivers with the OTP and collects cash', async ({ request }) => {
    await deliverBySelf(request, owner, customer.headers, order);
    const o = await call(request, 'get', `/orders/${order.id}`, { headers: customer.headers });
    expect(o.state).toBe('DELIVERED');
  });

  test('ratings: once per order, with a review; GET /orders/{id}/rating reflects it', async ({ request }) => {
    expect(await call(request, 'get', `/orders/${order.id}/rating`, { headers: customer.headers })).toEqual({ rating: null });
    // Letters only: digit runs look like phone numbers and the screen holds the review for moderation.
    const tag = Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8);
    const comment = `E2E review ${tag}: fresh atta, quick delivery`;
    await call(request, 'post', `/orders/${order.id}/rating`, { headers: customer.headers, data: { storeStars: 5, comment } });
    const dup = await request.post(`${API}/orders/${order.id}/rating`, { headers: customer.headers, data: { storeStars: 4 } });
    expect(dup.status()).toBe(409);
    expect((await call(request, 'get', `/orders/${order.id}/rating`, { headers: customer.headers })).rating).toMatchObject({ storeStars: 5, comment });

    const reviews = await call(request, 'get', `/stores/${SEED.kirana.id}/reviews?limit=50`);
    expect(reviews.summary.count).toBeGreaterThanOrEqual(1);
    expect(reviews.summary.distribution).toHaveLength(5);
    expect(reviews.summary.distribution[4]).toBeGreaterThanOrEqual(1);
    expect(reviews.items.map((r: { comment: string }) => r.comment)).toContain(comment);
  });

  test('discovery uses the rating: card, store page and the minRating filter agree with the summary', async ({ request }) => {
    const summary = (await call(request, 'get', `/stores/${SEED.kirana.id}/reviews`)).summary;
    const card = (await call(request, 'get', `/feed?${at}&tab=stores`)).stores.find((x: { id: string }) => x.id === SEED.kirana.id);
    expect(card.ratingCount).toBe(summary.count);
    expect(card.rating).toBeCloseTo(summary.avg, 1);
    const page = await call(request, 'get', `/stores/${SEED.kirana.id}?${at}`);
    expect(page.store.ratingCount).toBe(summary.count);
    const filtered = await call(request, 'get', `/feed?${at}&tab=stores&minRating=${Math.floor(card.rating)}`);
    expect(filtered.stores.map((x: { id: string }) => x.id)).toContain(SEED.kirana.id);
    const above = await call(request, 'get', `/feed?${at}&tab=stores&minRating=5`);
    if (card.rating < 5) expect(above.stores.map((x: { id: string }) => x.id)).not.toContain(SEED.kirana.id);
  });

  test('the partner sees the rating summary and the review', async ({ request }) => {
    const r = await call(request, 'get', '/merchants/me/reviews', { headers: owner });
    expect(r.summary.count).toBeGreaterThanOrEqual(1);
    expect(r.items.some((x: { orderId: string }) => x.orderId === order.id)).toBe(true);
  });

  test('public store page shows the rating bars and the review (web /s/{slug})', async ({ page, request }) => {
    const me = await call(request, 'get', '/merchants/me', { headers: owner });
    const slug = me.merchant.slug as string;
    expect(slug).toBeTruthy();
    await page.goto(`/s/${slug}`);
    await expect(page.getByTestId('store-name')).toHaveText(SEED.kirana.name);
    // The page is cached for 5 minutes (ISR): on test it may predate this run's rating.
    if (!LIVE) {
      await expect(page.getByTestId('rating-bars').getByRole('listitem')).toHaveCount(5);
      await expect(page.getByTestId('store-rating')).toContainText('★');
    }
  });
});
