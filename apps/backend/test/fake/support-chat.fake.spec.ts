/**
 * Support chat (ADR-028), fake mode:
 *  - a customer starts a chat about their order; ops see it in the inbox with the masked phone, reply (audited),
 *    the customer gets a push and an unread count, reads it, writes back; ops resolve; writing reopens it;
 *  - one conversation per order; at most 3 open chats; a spam limit per chat;
 *  - orders must be the requester's (customer, store, rider); topics per app; roles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { MockPushProvider, PushProvider } from '../../src/infra/providers/push/push.provider';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
let seq = 0;

describe('Support chat (fake mode)', () => {
  let fake: FakeApp;
  let push: MockPushProvider;
  let owner: Session;
  let ops: Session;
  const http = () => fake.http();

  async function customerWithOrder(phone: string) {
    const c = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(c.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    const items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items as Array<{ id: string; name: string; variants: Array<{ id: string }> }>;
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 2 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: a.body.id, when: { mode: 'asap' } }).expect(200)).body;
    const res = await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', `sup-${Date.now()}-${++seq}`).send({ quoteId: q.quoteId, paymentMethod: 'cod' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const o = res.body;
    return { c, order: o as { id: string; code: string } };
  }
  const open = (s: Session, body: Record<string, unknown>) => http().post('/v1/support/threads').set(s.headers).send(body);
  const audit = async (id: string) => ((await http().get(`/v1/ops/audit?entity=support_thread&entityId=${id}`).set(ops.headers).expect(200)).body.items as Array<{ action: string; after: Record<string, unknown> }>);

  beforeAll(async () => {
    fake = await bootFakeApp();
    push = fake.app.get(PushProvider) as MockPushProvider;
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant');
    await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200);
    await http().put('/v1/merchants/me/availability').set(owner.headers).send({ open: true }).expect(200);
    ops = await fake.opsSignIn();
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: a customer asks about an order; ops reply; the customer reads and answers; resolved; reopened by writing', async () => {
    const { c, order } = await customerWithOrder('9876502001');
    await http().put('/v1/me/push-token').set(c.headers).send({ token: 'fcm-token-customer-2001', platform: 'android' }).expect(204);

    const t = (await open(c, { topic: 'order_late', orderId: order.id, body: 'My order is late, where is it?' }).expect(201)).body;
    expect(t).toMatchObject({ app: 'consumer', orderCode: order.code, topic: 'order_late', status: 'waiting_support', unreadByUser: 0 });
    expect(t.messages.map((m: { author: string }) => m.author)).toEqual(['user']);

    const inbox = (await http().get('/v1/ops/support/threads?status=waiting_support').set(ops.headers).expect(200)).body.items;
    expect(inbox.map((x: { id: string }) => x.id)).toContain(t.id);
    const view = (await http().get(`/v1/ops/support/threads/${t.id}`).set(ops.headers).expect(200)).body;
    expect(view.requester.phoneMasked).toMatch(/\*/); // masked, never the full number
    expect(view.requester.phoneMasked).not.toContain('9876502001');

    const replied = (await http().post(`/v1/ops/support/threads/${t.id}/messages`).set(ops.headers).send({ body: 'Sorry! The store is packing it now, 10 more minutes.' }).expect(200)).body;
    expect(replied).toMatchObject({ status: 'waiting_customer', assigneeId: ops.user.id });
    expect(push.sent.filter((m) => m.token === 'fcm-token-customer-2001').at(-1)).toMatchObject({ title: 'Santha support replied', data: { kind: 'support', threadId: t.id } });
    expect((await audit(t.id)).find((a) => a.action === 'support.replied')?.after).toMatchObject({ status: 'waiting_customer' });
    expect(JSON.stringify(await audit(t.id))).not.toContain('packing it now'); // no message text in the audit log

    expect((await http().get('/v1/support/threads').set(c.headers).expect(200)).body.items[0]).toMatchObject({ id: t.id, unreadByUser: 1 });
    const read = (await http().get(`/v1/support/threads/${t.id}`).set(c.headers).expect(200)).body;
    expect(read.unreadByUser).toBe(0);
    expect(read.messages.map((m: { author: string }) => m.author)).toEqual(['user', 'support']);

    const answered = (await http().post(`/v1/support/threads/${t.id}/messages`).set(c.headers).send({ body: 'Thanks' }).expect(201)).body;
    expect(answered.status).toBe('waiting_support');

    await http().post(`/v1/ops/support/threads/${t.id}/resolve`).set(ops.headers).expect(200);
    expect((await http().get(`/v1/support/threads/${t.id}`).set(c.headers).expect(200)).body.status).toBe('resolved');
    await http().post(`/v1/support/threads/${t.id}/messages`).set(c.headers).send({ body: 'It arrived, but one packet is missing' }).expect(201);
    expect((await http().get(`/v1/support/threads/${t.id}`).set(c.headers).expect(200)).body.status).toBe('waiting_support');
    expect((await audit(t.id)).map((a) => a.action)).toEqual(expect.arrayContaining(['support.replied', 'support.resolved']));
  });

  it('one chat per order; at most 3 open chats; a spam limit per chat', async () => {
    const { c, order } = await customerWithOrder('9876502002');
    const first = (await open(c, { topic: 'missing_item', orderId: order.id, body: 'Atta missing' }).expect(201)).body;
    const again = (await open(c, { topic: 'wrong_item', orderId: order.id, body: 'Also the rice is wrong' }).expect(201)).body;
    expect(again.id).toBe(first.id); // same order → same conversation
    expect(again.messages).toHaveLength(2);

    await open(c, { topic: 'payment', body: 'Payment question' }).expect(201);
    await open(c, { topic: 'account', body: 'Change my number' }).expect(201);
    expect((await open(c, { topic: 'other', body: 'A fourth one' }).expect(429)).body.error.code).toBe('RATE_LIMITED');

    for (let i = 0; i < 8; i++) await http().post(`/v1/support/threads/${first.id}/messages`).set(c.headers).send({ body: `msg ${i}` }).expect(201);
    expect((await http().post(`/v1/support/threads/${first.id}/messages`).set(c.headers).send({ body: 'too many' }).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('orders must be yours; topics per app; stores can ask about their own orders; roles', async () => {
    const { order } = await customerWithOrder('9876502003');
    const stranger = await fake.signIn('9876502004', 'consumer');
    await open(stranger, { topic: 'order_late', orderId: order.id, body: 'Not my order' }).expect(404);
    await open(stranger, { topic: 'payout', body: 'Customers have no payouts' }).expect(400); // a partner topic
    await open(stranger, { topic: 'order_late', body: '' }).expect(400);

    const store = (await open(owner, { topic: 'orders', orderId: order.id, body: 'Customer asked for a different brand' }).expect(201)).body;
    expect(store).toMatchObject({ app: 'merchant', orderCode: order.code });
    const rider = await fake.signIn('9000000101', 'rider');
    await open(rider, { topic: 'delivery', orderId: order.id, body: 'Not my delivery' }).expect(404);
    await open(rider, { topic: 'payout', body: 'When is my payout?' }).expect(201);

    // Someone else's chat is not visible; only ops/support roles see the inbox.
    await http().get(`/v1/support/threads/${store.id}`).set(stranger.headers).expect(404);
    await http().get('/v1/ops/support/threads').set(owner.headers).expect(403);
    const mine = (await http().get('/v1/ops/support/threads?mine=true').set(ops.headers).expect(200)).body.items as Array<{ assigneeId: string }>;
    expect(mine.every((x) => x.assigneeId === ops.user.id)).toBe(true);
    await http().post(`/v1/ops/support/threads/${store.id}/assign`).set(ops.headers).expect(200);
    expect((await audit(store.id)).map((a) => a.action)).toContain('support.assigned');
  });
});
