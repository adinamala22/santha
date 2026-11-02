/**
 * M2 acceptance (fake mode): catalogue. "Scan 50 barcodes → ≥80% resolve against seeded master
 * data" and "staleness flag appears after 72 h (clock override)", plus the catalogue rules behind
 * them: price ≤ MRP with price-change audit, tri-state stock, prohibited-item holds, bulk CSV with
 * a validation report, assisted entry with merchant approval, kitchen slots and the image pipeline.
 */
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { seedMasterRows } from '../../src/dev/seed-catalogue';
import { MOCK_BARCODE_HITS } from '../../src/infra/providers/barcode/barcode.provider';
import { withCheckDigit } from '../../src/modules/merchant-catalogue/domain/gtin';
import { bootFakeApp, type FakeApp, type Session, testImage } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const kitchen = SEED_MERCHANTS.find((m) => m.name === "Saraswathi's Kitchen")!;
const fashion = SEED_MERCHANTS.find((m) => m.name === 'Kavya Boutique')!;
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const at = `lat=${dargamitta.lat}&lng=${dargamitta.lng}`;

/**
 * A kirana's 50-scan session: 42 packaged goods from the seeded master catalogue, 3 that only the
 * open-barcode source knows, and 5 local products nobody has (unbranded, regional).
 */
function scanSession(): { codes: string[]; unknown: string[] } {
  const seeded = seedMasterRows().filter((_, i) => i % 5 === 0).slice(0, 42).map((r) => r.barcode);
  const open = MOCK_BARCODE_HITS.map((h) => h.barcode);
  const unknown = ['89099900001', '89099900002', '89099900003', '89099900004', '89099900005'].map((b) => withCheckDigit(`${b}0`));
  return { codes: [...seeded, ...open, ...unknown], unknown };
}

describe('M2 · catalogue (fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let ops: Session;
  const http = () => fake.http();
  const search = async (q: string) => (await http().get(`/v1/search?${at}&q=${encodeURIComponent(q)}`).expect(200)).body;
  const itemNamesIn = (body: { groups: Array<{ store: { id: string }; items: Array<{ name: string }> }> }, storeId: string) =>
    body.groups.find((g) => g.store.id === storeId)?.items.map((i) => i.name) ?? [];

  beforeAll(async () => {
    fake = await bootFakeApp();
    owner = await fake.signIn(kirana.ownerPhone, 'merchant');
    ops = await fake.opsSignIn();
  }, 60_000);
  afterAll(() => fake?.close());

  it('the demo catalogue is loaded: every live SKU has a category, variants and a price', async () => {
    const page = await http().get('/v1/merchants/me/items?limit=200').set(owner.headers).expect(200);
    expect(page.body.total).toBeGreaterThanOrEqual(40);
    for (const i of page.body.items) {
      expect(i.categorySlug).toBeTruthy();
      expect(i.variants.length).toBeGreaterThan(0);
      for (const v of i.variants) expect(v.mrpPaise == null || v.pricePaise <= v.mrpPaise).toBe(true);
    }
  });

  // ───── acceptance: scan 50 barcodes → ≥80% resolve ─────

  it('ACCEPTANCE: scanning 50 barcodes resolves ≥80% against the master catalogue; misses go to the enrichment queue', async () => {
    const { codes, unknown } = scanSession();
    expect(codes).toHaveLength(50);
    let resolved = 0;
    const sources: Record<string, number> = {};
    for (const code of codes) {
      const r = await http().get(`/v1/catalogue/barcodes/${code}`).set(owner.headers);
      if (r.status === 200) {
        resolved++;
        sources[r.body.source] = (sources[r.body.source] ?? 0) + 1;
        expect(r.body.product).toMatchObject({ barcode: code, name: expect.any(String), categorySlug: expect.any(String) });
      } else {
        expect(r.status).toBe(404);
        expect(r.body.error.code).toBe('BARCODE_UNKNOWN');
      }
    }
    expect(resolved / codes.length).toBeGreaterThanOrEqual(0.8);
    expect(sources).toEqual({ master: 42, open_barcode: 3 });
    const queue = await http().get('/v1/ops/catalogue/barcode-requests').set(ops.headers).expect(200);
    expect(queue.body.items.map((r: { barcode: string }) => r.barcode)).toEqual(expect.arrayContaining(unknown));
  });

  it('a seeded product the store already sells is flagged on scan (scan again = edit)', async () => {
    const page = await http().get('/v1/merchants/me/items?q=Sona%20Masoori').set(owner.headers).expect(200);
    const item = page.body.items[0];
    const master = seedMasterRows().find((r) => `${r.brand} ${r.name}` === item.name)!;
    const r = await http().get(`/v1/catalogue/barcodes/${master.barcode}`).set(owner.headers).expect(200);
    expect(r.body.existingItemId).toBe(item.id);
  });

  it('a barcode with a wrong check digit is a 400, not a queue entry', async () => {
    const r = await http().get('/v1/catalogue/barcodes/8901000000010').set(owner.headers).expect(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('ops enrichment resolves a queued barcode; the next scan finds it; the action is audited', async () => {
    const code = scanSession().unknown[0]!;
    await http()
      .post('/v1/ops/catalogue/master')
      .set(ops.headers)
      .send({ barcode: code, name: 'Nellore Special Pickle Masala', brand: 'Local', mrpPaise: 6000, packLabel: '100 g', categorySlug: 'masala' })
      .expect(201);
    const r = await http().get(`/v1/catalogue/barcodes/${code}`).set(owner.headers).expect(200);
    expect(r.body.product).toMatchObject({ name: 'Nellore Special Pickle Masala', unit: 'g', unitQty: 100, source: 'ops' });
    const queue = await http().get('/v1/ops/catalogue/barcode-requests').set(ops.headers).expect(200);
    expect(queue.body.items.map((x: { barcode: string }) => x.barcode)).not.toContain(code);
    const audit = await http().get(`/v1/ops/audit?entity=master_product&entityId=${r.body.product.id}`).set(ops.headers).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'enriched' });
  });

  // ───── items: price ≤ MRP, audit, stock ─────

  let itemId: string;
  let variantId: string;

  it('create from a scanned product: price above the MRP is refused (FR-CAT-6)', async () => {
    const master = scanSession().unknown[0]!;
    const p = (await http().get(`/v1/catalogue/barcodes/${master}`).set(owner.headers).expect(200)).body.product;
    const tooDear = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ masterProductId: p.id, foodMark: 'veg', variants: [{ label: '100 g', unit: 'g', unitQty: 100, pricePaise: 6500 }] })
      .expect(400);
    expect(tooDear.body.error.details.problems[0]).toMatchObject({ field: 'variants.0.pricePaise', message: expect.stringMatching(/MRP/) });

    const ok = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ masterProductId: p.id, foodMark: 'veg', variants: [{ label: '100 g', unit: 'g', unitQty: 100, pricePaise: 5500 }] })
      .expect(201);
    expect(ok.body).toMatchObject({ status: 'active', source: 'master', categorySlug: 'masala', name: 'Local Nellore Special Pickle Masala 100 g' });
    expect(ok.body.variants[0]).toMatchObject({ pricePaise: 5500, mrpPaise: 6000, stock: 'in' });
    itemId = ok.body.id;
    variantId = ok.body.variants[0].id;
  });

  it('a new item is searchable at once (indexed from item.created)', async () => {
    expect(itemNamesIn(await search('pickle masala'), kirana.id)).toContain('Local Nellore Special Pickle Masala 100 g');
  });

  it('price changes are logged and visible in the ops audit log', async () => {
    await http()
      .patch(`/v1/merchants/me/items/${itemId}`)
      .set(owner.headers)
      .send({ variants: [{ id: variantId, label: '100 g', unit: 'g', unitQty: 100, pricePaise: 5800 }] })
      .expect(200);
    const audit = await http().get(`/v1/ops/audit?entity=item&entityId=${itemId}`).set(ops.headers).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'price_changed', before: { pricePaise: 5500 }, after: { pricePaise: 5800 }, actorId: owner.user.id });
  });

  it('food sellers must mark veg / non-veg; unknown categories for the store type are refused', async () => {
    const noMark = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ name: 'Loose Groundnuts', categorySlug: 'staples', variants: [{ label: '500 g', unit: 'g', unitQty: 500, pricePaise: 6000 }] })
      .expect(400);
    expect(noMark.body.error.details.problems.map((p: { field: string }) => p.field)).toEqual(['foodMark']);
    const wrongCat = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ name: 'Cotton Saree', categorySlug: 'sarees', variants: [{ label: 'Free size', unit: 'pc', unitQty: 1, pricePaise: 90000 }] })
      .expect(400);
    expect(wrongCat.body.error.details.problems[0].field).toBe('categorySlug');
  });

  it('tri-state stock: low stays listed, out leaves search, back in returns', async () => {
    await http().put(`/v1/merchants/me/items/${itemId}/stock`).set(owner.headers).send({ stock: 'low' }).expect(200);
    expect(itemNamesIn(await search('pickle masala'), kirana.id)).toContain('Local Nellore Special Pickle Masala 100 g');
    const out = await http().put(`/v1/merchants/me/items/${itemId}/stock`).set(owner.headers).send({ stock: 'out', variantId }).expect(200);
    expect(out.body.stock).toBe('out');
    expect(itemNamesIn(await search('pickle masala'), kirana.id)).not.toContain('Local Nellore Special Pickle Masala 100 g');
    await http().put(`/v1/merchants/me/items/${itemId}/stock`).set(owner.headers).send({ stock: 'in' }).expect(200);
    expect(itemNamesIn(await search('pickle masala'), kirana.id)).toContain('Local Nellore Special Pickle Masala 100 g');
  });

  it('hide, then delete: the item leaves search and the list', async () => {
    await http().patch(`/v1/merchants/me/items/${itemId}`).set(owner.headers).send({ hidden: true }).expect(200);
    expect(itemNamesIn(await search('pickle masala'), kirana.id)).toEqual([]);
    await http().delete(`/v1/merchants/me/items/${itemId}`).set(owner.headers).expect(204);
    await http().get(`/v1/merchants/me/items/${itemId}`).set(owner.headers).expect(404);
  });

  // ───── prohibited items (FR-CAT-7) ─────

  it('a restricted item is held for review, not searchable until ops releases it (audited)', async () => {
    const held = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ name: 'Gutkha Pouch', categorySlug: 'other_retail', variants: [{ label: '1 pc', unit: 'pc', unitQty: 1, pricePaise: 500 }] })
      .expect(201);
    expect(held.body).toMatchObject({ status: 'in_review', reviewReason: expect.stringMatching(/tobacco/) });
    expect(itemNamesIn(await search('gutkha'), kirana.id)).toEqual([]);

    const queue = await http().get('/v1/ops/catalogue/items?status=in_review').set(ops.headers).expect(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(held.body.id);
    const rejected = await http().post(`/v1/ops/catalogue/items/${held.body.id}/review`).set(ops.headers).send({ decision: 'reject', note: 'Tobacco is not allowed' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'hidden', reviewReason: 'Tobacco is not allowed' });
    const audit = await http().get(`/v1/ops/audit?entity=item&entityId=${held.body.id}`).set(ops.headers).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'rejected', actorId: ops.user.id });

    // A harmless lookalike ("ginger beer") is not held; a false positive can be released.
    const fp = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ name: 'Rum Essence for baking', categorySlug: 'masala', foodMark: 'veg', variants: [{ label: '20 ml', unit: 'ml', unitQty: 20, pricePaise: 3000 }] })
      .expect(201);
    expect(fp.body.status).toBe('active');
  });

  it('ops-only: merchants cannot review items; consumers cannot reach the catalogue API', async () => {
    await http().get('/v1/ops/catalogue/items').set(owner.headers).expect(403);
    const consumer = await fake.signIn(fake.seeded('consumer').phone, 'consumer');
    await http().get('/v1/merchants/me/items').set(consumer.headers).expect(403);
    await http().get('/v1/catalogue/barcodes/8901000000019').set(consumer.headers).expect(403);
  });

  // ───── bulk CSV (FR-CAT-4) ─────

  const csv = [
    'name,name_te,category,size,unit,qty,price,mrp,stock,food_mark,allergens,barcode',
    'Loose Sona Masoori,సోనా మసూరి,staples,1 kg,kg,1,58,,in,veg,,',
    'Loose Sona Masoori,సోనా మసూరి,staples,5 kg,kg,5,280,,in,veg,,',
    'Groundnut Chikki,,snacks,100 g,g,100,25,20,in,veg,peanut,', // price above MRP
    'Mystery Item,,staples,1 kg,kg,1,abc,,in,veg,,', // bad price
    'Gold Flake Cigarettes,,other_retail,10 pc,pc,10,180,,in,,,', // held
    'Wheat Rava,,staples,500 g,g,500,30,,low,veg,gluten;sesame,',
  ].join('\n');

  it('bulk CSV: dry run reports rejected rows with reasons and changes nothing', async () => {
    const before = (await http().get('/v1/merchants/me/items?limit=1').set(owner.headers)).body.total;
    const r = await http().post('/v1/merchants/me/items/import').set(owner.headers).send({ csv, dryRun: true }).expect(200);
    expect(r.body).toMatchObject({ dryRun: true, rows: 6, created: 0 });
    expect(r.body.rejected).toEqual([
      { line: 4, reasons: ['Selling price cannot be more than the MRP'] },
      { line: 5, reasons: ['price is not a valid amount'] },
    ]);
    expect(r.body.items.map((i: { name: string }) => i.name)).toEqual(['Loose Sona Masoori', 'Gold Flake Cigarettes', 'Wheat Rava']);
    expect((await http().get('/v1/merchants/me/items?limit=1').set(owner.headers)).body.total).toBe(before);
  });

  it('bulk CSV: import creates items (sizes grouped), holds restricted ones', async () => {
    const r = await http().post('/v1/merchants/me/items/import').set(owner.headers).send({ csv, dryRun: false }).expect(200);
    expect(r.body).toMatchObject({ created: 3, held: 1 });
    const rice = await http().get(`/v1/merchants/me/items/${r.body.items[0].itemId}`).set(owner.headers).expect(200);
    expect(rice.body).toMatchObject({ name: 'Loose Sona Masoori', nameTe: 'సోనా మసూరి', source: 'import' });
    expect(rice.body.variants.map((v: { label: string; pricePaise: number }) => [v.label, v.pricePaise])).toEqual([['1 kg', 5800], ['5 kg', 28000]]);
    const missingCols = await http().post('/v1/merchants/me/items/import').set(owner.headers).send({ csv: 'title,cost\nx,1' }).expect(400);
    expect(missingCols.body.error.message).toMatch(/Missing columns: name, category, price/);
  });

  // ───── assisted entry (FR-CAT-3) ─────

  it('assisted entry: ops builds items for a merchant; they wait for the merchant, who approves in bulk', async () => {
    const boutique = await fake.signIn(fashion.ownerPhone, 'merchant');
    const a = await http()
      .post(`/v1/ops/catalogue/merchants/${fashion.id}/items`)
      .set(ops.headers)
      .send({ name: 'Kanchi Pattu Saree', categorySlug: 'sarees', variants: [{ label: 'Free size', unit: 'pc', unitQty: 1, pricePaise: 1250000 }] })
      .expect(201);
    expect(a.body).toMatchObject({ status: 'pending_merchant', source: 'ops' });
    const list = await http()
      .post(`/v1/ops/catalogue/merchants/${fashion.id}/items/import`)
      .set(ops.headers)
      .send({ csv: 'name,category,size,unit,price\nCotton Kurti Set,women_wear,M,pc,850\nCotton Kurti Set,women_wear,L,pc,850\n' })
      .expect(200);
    expect(list.body.created).toBe(1);

    const pending = await http().get('/v1/merchants/me/items?status=pending_merchant').set(boutique.headers).expect(200);
    expect(pending.body.total).toBe(2);
    expect((await search('pattu')).groups).toEqual([]); // not live before approval (and fashion is in another area anyway)

    const ok = await http().post('/v1/merchants/me/items/approve').set(boutique.headers).send({ ids: 'all' }).expect(200);
    expect(ok.body).toEqual({ approved: 2, held: 0 });
    const active = await http().get(`/v1/merchants/me/items/${a.body.id}`).set(boutique.headers).expect(200);
    expect(active.body.status).toBe('active');
    const audit = await http().get(`/v1/ops/audit?entity=item&entityId=${a.body.id}`).set(ops.headers).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'assisted_created', actorId: ops.user.id });
  });

  // ───── home kitchens (FR-CAT-5) ─────

  it('kitchen slots: replaced as a set, overlaps refused, next open slot shown; other store types cannot have slots', async () => {
    const cook = await fake.signIn(kitchen.ownerPhone, 'merchant');
    const seeded = await http().get('/v1/merchants/me/slots').set(cook.headers).expect(200);
    expect(seeded.body.slots).toHaveLength(3);
    const all = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const overlap = await http()
      .put('/v1/merchants/me/slots')
      .set(cook.headers)
      .send({ slots: [{ days: all, start: '12:00', end: '13:00', cutoffMin: 60, capacity: 10 }, { days: ['mon'], start: '12:30', end: '13:30', cutoffMin: 60, capacity: 5 }] })
      .expect(400);
    expect(overlap.body.error.message).toMatch(/Overlaps/);
    const saved = await http()
      .put('/v1/merchants/me/slots')
      .set(cook.headers)
      .send({ slots: [{ label: 'Lunch', days: all, start: '12:30', end: '13:00', cutoffMin: 90, capacity: 12 }, { label: 'Dinner', days: all, start: '19:30', end: '20:00', cutoffMin: 120, capacity: 10 }] })
      .expect(200);
    expect(saved.body.slots.map((s: { label: string }) => s.label)).toEqual(['Lunch', 'Dinner']);
    expect(saved.body.nextOpen).toMatchObject({ state: 'open' });
    expect(new Date(saved.body.nextOpen.cutoffAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    await http().put('/v1/merchants/me/slots').set(owner.headers).send({ slots: [] }).expect(409);
  });

  it('kitchen menu fields: portion variants, daily capacity, menu days; not allowed for a kirana', async () => {
    const cook = await fake.signIn(kitchen.ownerPhone, 'merchant');
    const r = await http()
      .post('/v1/merchants/me/items')
      .set(cook.headers)
      .send({
        name: 'Royyala Iguru',
        nameTe: 'రొయ్యల ఇగురు',
        categorySlug: 'curries',
        foodMark: 'non_veg',
        allergens: ['shellfish'],
        availableDays: ['sat', 'sun'],
        dailyCapacity: 10,
        variants: [{ label: 'Serves 2', unit: 'portion', unitQty: 2, pricePaise: 45000 }],
      })
      .expect(201);
    expect(r.body).toMatchObject({ availableDays: ['sat', 'sun'], dailyCapacity: 10, allergens: ['shellfish'] });
    const wrong = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ name: 'Tea', categorySlug: 'beverages', foodMark: 'veg', dailyCapacity: 5, variants: [{ label: '1', unit: 'pc', unitQty: 1, pricePaise: 1000 }] })
      .expect(400);
    expect(wrong.body.error.details.problems[0].field).toBe('availableDays');
  });

  // ───── image pipeline ─────

  it('item photo: WebP thumb ≤ 40 KB + medium, moderated before customers see it', async () => {
    const big = await testImage(1600, 1200);
    const photo = await fake.uploadPhoto(owner, 'item', big);
    expect(photo.status).toBe('pending_review');
    const thumb = await http().get(photo.thumbUrl).expect(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.body.length).toBeLessThanOrEqual(40 * 1024);
    const meta = await sharp(thumb.body).metadata();
    expect([meta.width, meta.height]).toEqual([320, 320]);
    expect((await sharp((await http().get(photo.mediumUrl).expect(200)).body).metadata()).width).toBe(960);

    const created = await http()
      .post('/v1/merchants/me/items')
      .set(owner.headers)
      .send({ name: 'Homemade Ghee', categorySlug: 'oils_ghee', foodMark: 'veg', allergens: ['milk'], imageIds: [photo.id], variants: [{ label: '500 ml', unit: 'ml', unitQty: 500, pricePaise: 45000 }] })
      .expect(201);
    expect(created.body.imageUrl).toBeNull(); // not approved yet
    const queue = await http().get('/v1/ops/catalogue/media').set(ops.headers).expect(200);
    expect(queue.body.items.map((m: { id: string }) => m.id)).toContain(photo.id);
    await http().post(`/v1/ops/catalogue/media/${photo.id}/review`).set(ops.headers).send({ decision: 'approve' }).expect(200);
    const after = await http().get(`/v1/merchants/me/items/${created.body.id}`).set(owner.headers).expect(200);
    expect(after.body.imageUrl).toBe(photo.mediumUrl);
    const hit = (await search('homemade ghee')).groups.find((g: { store: { id: string } }) => g.store.id === kirana.id);
    expect(hit.items[0].imageUrl).toBe(photo.mediumUrl); // reindexed on media.approved
  });

  it('uploads must be real photos of a usable size', async () => {
    const t = await http().post('/v1/merchants/me/media').set(owner.headers).send({ purpose: 'item', contentType: 'image/png' }).expect(201);
    await http().put(t.body.upload.url).set('Content-Type', 'image/png').send(Buffer.from('not an image')).expect(200);
    const r = await http().post(`/v1/merchants/me/media/${t.body.media.id}/complete`).set(owner.headers).expect(400);
    expect(r.body.error.message).toMatch(/not a photo/);
    const tiny = await fake.uploadPhoto(owner, 'item', await testImage(100, 100)).catch((e: Error) => e);
    expect(String(tiny)).toMatch(/400/);
    await http().post('/v1/merchants/me/media').set(owner.headers).send({ purpose: 'item', contentType: 'image/gif' }).expect(400);
    await http().put(`${t.body.upload.url}x`).set('Content-Type', 'image/png').send(await testImage()).expect(403); // tampered signature
  });

  // ───── acceptance: staleness after 72 h ─────

  it('ACCEPTANCE: the staleness flag appears after 72 h (dev clock), lowers search rank and clears on confirm', async () => {
    const sweep0 = await http().post('/v1/ops/catalogue/staleness-sweep').set(ops.headers).expect(200);
    expect(sweep0.body.flagged).toBe(0); // everything was confirmed at boot

    await fake.advanceClock(71);
    expect((await http().post('/v1/ops/catalogue/staleness-sweep').set(ops.headers).expect(200)).body.flagged).toBe(0);

    await fake.advanceClock(2); // 73 h
    const sweep = await http().post('/v1/ops/catalogue/staleness-sweep').set(ops.headers).expect(200);
    expect(sweep.body.flagged).toBeGreaterThan(100);

    const stale = await http().get('/v1/merchants/me/items?stale=true&limit=200').set(owner.headers).expect(200);
    expect(stale.body.total).toBeGreaterThan(40);
    expect(stale.body.items.every((i: { stale: boolean }) => i.stale)).toBe(true);
    const rice = (await search('sona masoori')).groups.find((g: { store: { id: string } }) => g.store.id === kirana.id);
    expect(rice.items.some((i: { stale: boolean }) => i.stale)).toBe(true);
    const summary = await http().get('/v1/ops/catalogue/summary').set(ops.headers).expect(200);
    expect(summary.body.staleItems).toBeGreaterThan(100);

    // One stock toggle confirms one item; the daily check confirms the rest.
    const one = stale.body.items[0];
    expect((await http().put(`/v1/merchants/me/items/${one.id}/stock`).set(owner.headers).send({ stock: 'in' }).expect(200)).body.stale).toBe(false);
    const c = await http().post('/v1/merchants/me/items/confirm').set(owner.headers).expect(200);
    expect(c.body.confirmed).toBeGreaterThan(40);
    expect((await http().get('/v1/merchants/me/items?stale=true').set(owner.headers)).body.total).toBe(0);
    const audit = await http().get('/v1/ops/audit?entity=catalogue').set(ops.headers).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'staleness_sweep' });
  });
});
