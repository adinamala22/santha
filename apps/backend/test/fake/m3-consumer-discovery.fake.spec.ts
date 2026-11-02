/**
 * M3 acceptance (fake mode), backend side of consumer discovery: saved addresses with
 * serviceability (FR-LOC-1), the store page and home-kitchen page payloads (FR-DIS-5, FR-CAT-5),
 * category browse and "did you mean" hints in search (FR-DIS-2/3), one-tap ADD data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_ADDRESSES, SEED_MERCHANTS, SEED_MICRO_MARKETS, SEED_OUTSIDE_POINT } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const centre = (slug: string) => SEED_MICRO_MARKETS.find((m) => m.slug === slug)!.centre;
const q = (p: { lat: number; lng: number }) => `lat=${p.lat}&lng=${p.lng}`;
const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const kitchen = SEED_MERCHANTS.find((m) => m.name === "Saraswathi's Kitchen")!;
const footwear = SEED_MERCHANTS.find((m) => m.name === 'Nellore Footwear')!; // submitted, not live

describe('M3 · consumer discovery backend (fake mode)', () => {
  let fake: FakeApp;
  let consumer: Session;
  const http = () => fake.http();

  beforeAll(async () => {
    fake = await bootFakeApp();
    consumer = await fake.signIn(fake.seeded('consumer').phone, 'consumer');
  }, 60_000);
  afterAll(() => fake?.close());

  // ───── saved addresses ─────

  it('the seeded consumer has saved addresses, default first, each with its micro-market', async () => {
    const r = await http().get('/v1/me/addresses').set(consumer.headers).expect(200);
    const mine = SEED_ADDRESSES.filter((a) => a.ownerPhone === fake.seeded('consumer').phone);
    expect(r.body.items).toHaveLength(mine.length);
    expect(r.body.items[0]).toMatchObject({ label: 'home', isDefault: true, serviceable: true, microMarket: { slug: 'dargamitta' } });
    expect(r.body.items[1]).toMatchObject({ label: 'work', isDefault: false, microMarket: { slug: 'magunta-layout' } });
  });

  it('adds an address (serviceable or not), switches the default, edits and deletes', async () => {
    const s = await fake.signIn('9876500901', 'consumer');
    const first = await http()
      .post('/v1/me/addresses')
      .set(s.headers)
      .send({ label: 'home', line: '1-2, Vedayapalem Main Road', location: centre('vedayapalem'), pincode: '524004' })
      .expect(201);
    expect(first.body).toMatchObject({ isDefault: true, serviceable: true, microMarket: { slug: 'vedayapalem' } }); // first one is the default
    const far = await http()
      .post('/v1/me/addresses')
      .set(s.headers)
      .send({ label: 'other', name: 'Amma', line: '9, Ring Road, Nellore', location: SEED_OUTSIDE_POINT, isDefault: true })
      .expect(201);
    expect(far.body).toMatchObject({ name: 'Amma', isDefault: true, serviceable: false, microMarket: null });
    const list = await http().get('/v1/me/addresses').set(s.headers).expect(200);
    expect(list.body.items.map((a: { id: string; isDefault: boolean }) => [a.id, a.isDefault])).toEqual([
      [far.body.id, true],
      [first.body.id, false],
    ]);

    const moved = await http().patch(`/v1/me/addresses/${far.body.id}`).set(s.headers).send({ location: centre('dargamitta') }).expect(200);
    expect(moved.body).toMatchObject({ serviceable: true, microMarket: { slug: 'dargamitta' } });

    await http().delete(`/v1/me/addresses/${far.body.id}`).set(s.headers).expect(204);
    const after = await http().get('/v1/me/addresses').set(s.headers).expect(200);
    expect(after.body.items).toEqual([expect.objectContaining({ id: first.body.id, isDefault: true })]); // default moves on
  });

  it('addresses are private, validated, and capped at 10', async () => {
    const other = await fake.signIn('9876500902', 'consumer');
    const mine = (await http().get('/v1/me/addresses').set(consumer.headers)).body.items[0];
    await http().patch(`/v1/me/addresses/${mine.id}`).set(other.headers).send({ line: 'hijack attempt here' }).expect(404);
    await http().post('/v1/me/addresses').set(other.headers).send({ label: 'home', line: 'x', location: centre('dargamitta') }).expect(400);
    for (let i = 0; i < 10; i++)
      await http().post('/v1/me/addresses').set(other.headers).send({ label: 'other', line: `House ${i}, Dargamitta`, location: centre('dargamitta') }).expect(201);
    const eleventh = await http().post('/v1/me/addresses').set(other.headers).send({ label: 'other', line: 'House 11, Dargamitta', location: centre('dargamitta') }).expect(400);
    expect(eleventh.body.error.message).toMatch(/up to 10/);
    await http().get('/v1/me/addresses').expect(401);
  });

  // ───── store page ─────

  it('store page: trust row, delivery info, categories and items with sizes; ADD data on every item', async () => {
    const r = await http().get(`/v1/stores/${kirana.id}?${q(centre('dargamitta'))}`).expect(200);
    const b = r.body;
    expect(b.store).toMatchObject({ name: 'Ramesh Stores', type: 'retail', selfDelivers: true, eta: { mode: 'asap' } });
    expect(b).toMatchObject({ deliversHere: true, fssaiVerified: true, microMarket: { slug: 'dargamitta' }, freeDeliveryAbovePaise: 19900 });
    expect(b.photos[0].mediumUrl).toContain('medium.webp');
    expect(b.categories.map((c: { slug: string }) => c.slug)).toEqual(expect.arrayContaining(['staples', 'dairy', 'snacks']));
    expect(b.categories.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(b.items.length);
    const atta = b.items.find((i: { name: string }) => i.name === 'Annapoorna Chakki Atta');
    expect(atta.variants.map((v: { label: string }) => v.label)).toEqual(['1 kg', '5 kg', '10 kg']);
    expect(atta).toMatchObject({ merchantId: kirana.id, variantId: expect.any(String), allergens: ['gluten'], foodMark: 'veg' });
    for (const v of atta.variants) expect(v.pricePaise).toBeLessThanOrEqual(v.mrpPaise);
  });

  it('store page from far away: still readable, but says it does not deliver here', async () => {
    const r = await http().get(`/v1/stores/${kirana.id}?${q(centre('vedayapalem'))}`).expect(200);
    expect(r.body.deliversHere).toBe(false);
  });

  it('home-kitchen page: FSSAI + hygiene badges, slots with cut-offs, menu flags, portions and allergens', async () => {
    const r = await http().get(`/v1/stores/${kitchen.id}?${q(centre('dargamitta'))}`).expect(200);
    const b = r.body;
    expect(b).toMatchObject({ fssaiVerified: true, hygieneDeclared: true, store: { type: 'home_kitchen', eta: { mode: 'scheduled' } } });
    expect(b.slots.occurrences.length).toBeGreaterThanOrEqual(3);
    for (const o of b.slots.occurrences) expect(new Date(o.cutoffAt).getTime()).toBeLessThan(new Date(o.startsAt).getTime());
    const pulusu = b.items.find((i: { name: string }) => i.name.startsWith('Nellore Chepala Pulusu'));
    expect(pulusu).toMatchObject({ foodMark: 'non_veg', allergens: ['fish', 'mustard'], dailyCapacity: 15, special: true, onMenuToday: true });
    expect(pulusu.variants[0]).toMatchObject({ label: 'Serves 2' });
    const weekend = b.items.find((i: { name: string }) => i.name === 'Gongura Mutton');
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date()).toLowerCase();
    expect(weekend.onMenuToday).toBe(['sat', 'sun'].includes(day));
  });

  it('stores that are not live are not served', async () => {
    await http().get(`/v1/stores/${footwear.id}?${q(centre('dargamitta'))}`).expect(404);
    await http().get(`/v1/stores/00000000-0000-4000-8000-000000000000?${q(centre('dargamitta'))}`).expect(404);
  });

  // ───── search additions ─────

  it('category browse: every in-stock item of the category, grouped by store', async () => {
    const r = await http().get(`/v1/search?${q(centre('balaji-nagar'))}&category=vegetables`).expect(200);
    expect(r.body.groups.map((g: { store: { name: string } }) => g.store.name)).toEqual(['Balaji Fruits & Vegetables']);
    expect(r.body.totalItems).toBeGreaterThan(10);
    for (const i of r.body.groups[0].items) expect(i.categorySlug).toBe('vegetables');
    await http().get(`/v1/search?${q(centre('balaji-nagar'))}`).expect(400); // neither q nor category
  });

  it('"did you mean" hints offer Telugu and transliterated forms', async () => {
    const r = await http().get(`/v1/search?${q(centre('dargamitta'))}&q=atta`).expect(200);
    expect(r.body.hints).toEqual(expect.arrayContaining(['గోధుమ పిండి', 'godhuma pindi']));
    expect(r.body.hints).not.toContain('atta');
    const rice = await http().get(`/v1/search?${q(centre('dargamitta'))}&q=rice`).expect(200);
    expect(rice.body.hints[0]).toBe('బియ్యం'); // Telugu script first
    const none = await http().get(`/v1/search?${q(centre('dargamitta'))}&q=xylophone`).expect(200);
    expect(none.body.hints).toEqual([]);
  });

  it('search results carry what one-tap ADD needs', async () => {
    const r = await http().get(`/v1/search?${q(centre('dargamitta'))}&q=toor%20dal`).expect(200);
    const item = r.body.groups[0].items[0];
    expect(item).toMatchObject({ merchantId: kirana.id, variantId: expect.any(String), variantLabel: '500 g' });
  });
});
