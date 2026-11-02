/**
 * M5 acceptance (fake mode): the order lifecycle and the merchant flow.
 *
 * BUILD-PLAN M5 acceptance:
 *  - the new-order alert reaches the merchant app ≤5 s (here: socket event + urgent push, measured)
 *  - two ignored orders auto-pause the store
 *  - a substitution with a price difference refunds to the wallet instantly
 *  - illegal transitions are rejected (and logged)
 */
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const dargamitta = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
type StoreItem = { id: string; name: string; variants: Array<{ id: string; label: string; pricePaise: number; stock: string }> };

let seq = 0;
const key = () => `m5-key-${Date.now()}-${++seq}`;

describe('M5 · order lifecycle and merchant flow (fake mode)', () => {
  let fake: FakeApp;
  let owner: Session;
  let items: StoreItem[];
  let baseUrl: string;
  const http = () => fake.http();

  const line = (name: string, quantity: number, label?: string) => {
    const i = items.find((x) => x.name === name)!;
    const v = label ? i.variants.find((x) => x.label === label)! : i.variants[0]!;
    return { itemId: i.id, variantId: v.id, quantity };
  };
  /** A consumer with an address in Dargamitta. */
  async function customer(phone: string) {
    const s = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(s.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: dargamitta }).expect(201);
    return { ...s, addressId: a.body.id as string };
  }
  /** Places an order at Ramesh Stores; online orders are paid through the mock gateway. */
  async function order(c: Session & { addressId: string }, method: 'online' | 'cod', lines = [line('Annapoorna Chakki Atta', 2, '1 kg'), line('Annapoorna Basmati Rice', 1)]) {
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    expect(q.placeable).toBe(true);
    const o = (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', key()).send({ quoteId: q.quoteId, paymentMethod: method }).expect(201)).body;
    if (method === 'online') await http().post(`/v1/dev/payments/${o.payment.intentId}/succeed`).expect(200);
    return (await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body as { id: string; code: string; state: string; totalPaise: number };
  }
  const wallet = async (c: Session) => (await http().get('/v1/wallet').set(c.headers).expect(200)).body.balancePaise as number;
  const runTimers = () => http().post('/v1/dev/jobs/timers').expect(200);
  const ops = async () => (await fake.opsSignIn()).headers;

  beforeAll(async () => {
    fake = await bootFakeApp();
    await fake.app.listen(0);
    baseUrl = `http://127.0.0.1:${(fake.app.getHttpServer().address() as AddressInfo).port}`;
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200);
    await http().put('/v1/me/push-token').set(owner.headers).send({ token: 'merchant-fcm-token-ramesh-0001', platform: 'android' }).expect(204);
    items = (await http().get(`/v1/stores/${kirana.id}?lat=${dargamitta.lat}&lng=${dargamitta.lng}`).expect(200)).body.items;
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: a new order reaches the merchant at once (socket) and as an urgent push', async () => {
    const socket: Socket = io(baseUrl, { path: '/v1/realtime', transports: ['websocket'], auth: { token: owner.accessToken, deviceId: owner.deviceId } });
    await new Promise<void>((resolve, reject) => {
      socket.once('ready', () => resolve());
      socket.once('error', reject);
      setTimeout(() => reject(new Error('no ready')), 15_000);
    });
    const c = await customer('9876500701');
    const t0 = Date.now();
    const alert = new Promise<{ orderId: string; code: string; type: string }>((resolve) => socket.once('order.new', resolve));
    const o = await order(c, 'cod');
    const got = await alert;
    socket.disconnect();
    expect(got).toMatchObject({ orderId: o.id, code: o.code, type: 'order.placed' });
    expect(Date.now() - t0).toBeLessThan(5000);

    const comms = (await http().get(`/v1/ops/orders/${o.id}`).set(await ops()).expect(200)).body.comms;
    expect(comms).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'push', template: 'merchant.new_order', status: 'sent', to: 'merchant' })]));
    // The customer has no push token: they get the SMS fallback.
    expect(comms).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'sms', template: 'customer.order_placed', to: 'customer' })]));
    // Answer it, so its accept window does not count as a miss in later tests.
    await http().post(`/v1/orders/${o.id}/reject`).set(owner.headers).send({ reason: 'too_busy' }).expect(200);
  }, 30_000);

  it('accept → preparing (address revealed, pack-by set) → ready; the customer sees each step', async () => {
    const c = await customer('9876500702');
    const o = await order(c, 'online');
    const before = (await http().get(`/v1/merchants/me/orders/${o.id}`).set(owner.headers).expect(200)).body;
    expect(before).toMatchObject({ state: 'PLACED', address: null, instructions: null });
    expect(before.acceptBy).toBeTruthy();
    expect(before.distanceM).toBeGreaterThan(0);

    const accepted = (await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({ fulfilmentMode: 'self' }).expect(200)).body;
    expect(accepted).toMatchObject({ state: 'PREPARING', fulfilmentMode: 'self', address: { line: expect.stringContaining('Dargamitta') }, acceptBy: null });
    expect(accepted.packBy).toBeTruthy();
    const ready = (await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(200)).body;
    expect(ready.state).toBe('READY');

    const mine = (await http().get(`/v1/orders/${o.id}`).set(c.headers).expect(200)).body;
    expect(mine.history.map((h: { to: string }) => h.to)).toEqual(['AWAITING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY']);
    const comms = (await http().get(`/v1/ops/orders/${o.id}`).set(await ops()).expect(200)).body.comms.map((x: { template: string }) => x.template);
    expect(comms).toEqual(expect.arrayContaining(['customer.order_accepted', 'customer.order_ready']));

    const list = (await http().get('/v1/merchants/me/orders?bucket=ready').set(owner.headers).expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toContain(o.id);
    expect(list.summary.orders).toBeGreaterThanOrEqual(1);
    expect(list.summary.avgPrepMin).not.toBeNull();
  });

  it('ACCEPTANCE: illegal transitions are refused (409 INVALID_STATE)', async () => {
    const c = await customer('9876500703');
    const o = await order(c, 'cod');
    await http().post(`/v1/orders/${o.id}/ready`).set(owner.headers).expect(409); // not accepted yet
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({}).expect(200);
    const again = await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({}).expect(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    await http().post(`/v1/orders/${o.id}/reject`).set(owner.headers).send({ reason: 'too_busy' }).expect(409);
    await http().post(`/v1/orders/${o.id}/cancel`).set(c.headers).send({ reason: 'changed_mind' }).expect(409); // store already started
    // Other stores' owners and consumers cannot act on it
    const other = await fake.signIn(SEED_MERCHANTS.find((m) => m.name === 'Sri Lakshmi Supermarket')!.ownerPhone.replace('+91', ''), 'merchant');
    await http().post(`/v1/orders/${o.id}/ready`).set(other.headers).expect(404);
    await http().post(`/v1/orders/${o.id}/ready`).set(c.headers).expect(403);
  });

  it('ACCEPTANCE: a substitution with a price difference refunds to the wallet instantly', async () => {
    const c = await customer('9876500704');
    const o = await order(c, 'online');
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({}).expect(200);
    const atta = line('Annapoorna Chakki Atta', 2, '1 kg');
    const attaPrice = items.find((i) => i.name === 'Annapoorna Chakki Atta')!.variants.find((v) => v.label === '1 kg')!.pricePaise;
    const cheaper = items.flatMap((i) => i.variants.map((v) => ({ item: i, v }))).find((x) => x.item.name !== 'Annapoorna Chakki Atta' && x.v.stock !== 'out' && x.v.pricePaise < attaPrice)!;
    const expected = (attaPrice - cheaper.v.pricePaise) * 2;
    const before = await wallet(c);

    const r = (await http().post(`/v1/orders/${o.id}/items/${atta.variantId}/unavailable`).set(owner.headers).send({ action: 'substitute', itemId: cheaper.item.id, variantId: cheaper.v.id }).expect(200)).body;
    const subLine = r.lines.find((l: { variantId: string }) => l.variantId === atta.variantId);
    expect(subLine).toMatchObject({ status: 'substituted', substituteName: cheaper.item.name, refundPaise: expected });
    expect(r.refundedPaise).toBe(expected);
    expect(await wallet(c)).toBe(before + expected); // instantly

    // A dearer substitute is refused; removing the other item refunds its line too.
    const dearer = items.flatMap((i) => i.variants.map((v) => ({ item: i, v }))).find((x) => x.v.pricePaise > 50000 && x.v.stock !== 'out');
    if (dearer) {
      const rice = line('Annapoorna Basmati Rice', 1);
      await http().post(`/v1/orders/${o.id}/items/${rice.variantId}/unavailable`).set(owner.headers).send({ action: 'substitute', itemId: dearer.item.id, variantId: dearer.v.id }).expect(400);
    }
    const rice = line('Annapoorna Basmati Rice', 1);
    const ricePrice = items.find((i) => i.name === 'Annapoorna Basmati Rice')!.variants[0]!.pricePaise;
    await http().post(`/v1/orders/${o.id}/items/${rice.variantId}/unavailable`).set(owner.headers).send({ action: 'remove' }).expect(200);
    expect(await wallet(c)).toBe(before + expected + ricePrice);
    const comms = (await http().get(`/v1/ops/orders/${o.id}`).set(await ops()).expect(200)).body.comms.map((x: { template: string }) => x.template);
    expect(comms).toEqual(expect.arrayContaining(['customer.item_substituted', 'customer.item_removed']));
  });

  it('removing every item cancels the order and refunds the rest; COD removals lower the cash due', async () => {
    const c = await customer('9876500705');
    const online = await order(c, 'online', [line('Annapoorna Basmati Rice', 2)]);
    await http().post(`/v1/orders/${online.id}/accept`).set(owner.headers).send({}).expect(200);
    const before = await wallet(c);
    const r = (await http().post(`/v1/orders/${online.id}/items/${line('Annapoorna Basmati Rice', 1).variantId}/unavailable`).set(owner.headers).send({ action: 'remove' }).expect(200)).body;
    expect(r).toMatchObject({ state: 'CANCELLED', outcomeReason: 'all_items_unavailable', refundedPaise: online.totalPaise });
    expect(await wallet(c)).toBe(before + online.totalPaise);

    const c2 = await customer('9876500706');
    const cod = await order(c2, 'cod');
    await http().post(`/v1/orders/${cod.id}/accept`).set(owner.headers).send({}).expect(200);
    const atta = line('Annapoorna Chakki Atta', 2, '1 kg');
    const r2 = (await http().post(`/v1/orders/${cod.id}/items/${atta.variantId}/unavailable`).set(owner.headers).send({ action: 'remove' }).expect(200)).body;
    const attaLine = r2.lines.find((l: { variantId: string }) => l.variantId === atta.variantId).linePaise;
    expect(r2.codDuePaise).toBe(cod.totalPaise - attaLine);
    expect(await wallet(c2)).toBe(0); // nothing was paid, nothing to refund
  });

  it('reject refunds online orders in full; a customer can cancel before acceptance', async () => {
    const c = await customer('9876500707');
    const o = await order(c, 'online');
    const before = await wallet(c);
    const r = (await http().post(`/v1/orders/${o.id}/reject`).set(owner.headers).send({ reason: 'out_of_stock' }).expect(200)).body;
    expect(r).toMatchObject({ state: 'REJECTED', outcomeReason: 'out_of_stock' });
    expect(await wallet(c)).toBe(before + o.totalPaise);

    const o2 = await order(c, 'online');
    const cancelled = (await http().post(`/v1/orders/${o2.id}/cancel`).set(c.headers).send({ reason: 'changed_mind' }).expect(200)).body;
    expect(cancelled.state).toBe('CANCELLED');
    expect(await wallet(c)).toBe(before + o.totalPaise + o2.totalPaise);
  });

  it('WhatsApp updates only for customers who opted in', async () => {
    const c = await customer('9876500708');
    expect((await http().get('/v1/me/notification-preferences').set(c.headers).expect(200)).body).toEqual({ whatsappUpdates: false });
    await http().put('/v1/me/notification-preferences').set(c.headers).send({ whatsappUpdates: true }).expect(200);
    const o = await order(c, 'cod');
    await http().post(`/v1/orders/${o.id}/accept`).set(owner.headers).send({}).expect(200);
    const comms = (await http().get(`/v1/ops/orders/${o.id}`).set(await ops()).expect(200)).body.comms;
    expect(comms).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'whatsapp', template: 'customer.order_accepted' })]));
  });

  it('ACCEPTANCE: two ignored orders auto-pause the store (with SMS + call reminders first)', async () => {
    const c = await customer('9876500709');
    const first = await order(c, 'online');
    const before = await wallet(c);
    // 30 s: SMS reminder; 60 s: voice call; 120 s: expired and refunded.
    await fake.advanceClock(31 / 3600);
    await runTimers();
    await fake.advanceClock(30 / 3600);
    await runTimers();
    await fake.advanceClock(60 / 3600);
    await runTimers();
    const d = (await http().get(`/v1/ops/orders/${first.id}`).set(await ops()).expect(200)).body;
    expect(d.state).toBe('EXPIRED');
    expect(d.comms.map((x: { channel: string; template: string }) => `${x.channel}:${x.template}`)).toEqual(
      expect.arrayContaining(['sms:merchant.order_waiting', 'voice:merchant.order_waiting', 'push:merchant.new_order']),
    );
    expect(await wallet(c)).toBe(before + first.totalPaise);
    expect((await http().get('/v1/merchants/me').set(owner.headers).expect(200)).body.merchant.acceptingOrders).toBe(true); // one miss

    await order(c, 'cod');
    await fake.advanceClock(121 / 3600);
    await runTimers();
    const me = (await http().get('/v1/merchants/me').set(owner.headers).expect(200)).body.merchant;
    expect(me).toMatchObject({ acceptingOrders: false, pausedReason: 'missed_orders' });

    // Customers see the store closed and cannot check out
    const feed = (await http().get(`/v1/feed?lat=${dargamitta.lat}&lng=${dargamitta.lng}`).expect(200)).body;
    expect(feed.stores.find((s: { id: string }) => s.id === kirana.id).open).toBe(false);
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [line('Annapoorna Basmati Rice', 2)] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: c.addressId, when: { mode: 'asap' } }).expect(200)).body;
    expect(q.problems).toEqual(expect.arrayContaining([{ code: 'STORE_CLOSED' }]));

    // The owner re-opens the store
    const resumed = (await http().put('/v1/merchants/me/availability').set(owner.headers).send({ open: true }).expect(200)).body.merchant;
    expect(resumed).toMatchObject({ acceptingOrders: true, pausedReason: null });
    expect((await http().get(`/v1/feed?lat=${dargamitta.lat}&lng=${dargamitta.lng}`).expect(200)).body.stores.find((s: { id: string }) => s.id === kirana.id).open).toBe(true);
  });

  it('merchant tabs: counts per bucket; ops list filters by state', async () => {
    const list = (await http().get('/v1/merchants/me/orders?bucket=done').set(owner.headers).expect(200)).body;
    expect(list.counts.done).toBeGreaterThanOrEqual(3);
    expect(list.items.every((x: { state: string }) => ['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(x.state))).toBe(true);
    const expired = (await http().get('/v1/ops/orders?state=EXPIRED').set(await ops()).expect(200)).body.items;
    expect(expired.length).toBeGreaterThanOrEqual(2);
    expect(expired[0]).toMatchObject({ merchantName: 'Ramesh Stores', state: 'EXPIRED' });
    await http().get('/v1/ops/orders').set(owner.headers).expect(403);
  });
});
