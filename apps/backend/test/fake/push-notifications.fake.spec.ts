/**
 * Push notifications (review G1), fake mode with the recording push mock:
 *  - a partner phone registers its FCM token; a new order rings it (urgent, alarm channel, order id in data);
 *  - signing out removes that phone's token: the next order is not pushed to it (SMS fallback instead);
 *  - a token belongs to one phone and one person: another person signing in on the phone takes it over.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { everyDay } from '../../src/common/hours';
import { SEED_MERCHANTS, SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { MockPushProvider, PushProvider } from '../../src/infra/providers/push/push.provider';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const kirana = SEED_MERCHANTS.find((m) => m.name === 'Ramesh Stores')!;
const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
let seq = 0;

describe('Push notifications (fake mode)', () => {
  let fake: FakeApp;
  let push: MockPushProvider;
  let owner: Session;
  let ops: Session['headers'];
  const http = () => fake.http();
  const DEVICE = 'partner-phone-0001';

  async function placeOrder(phone: string) {
    const c = await fake.signIn(phone, 'consumer');
    const a = await http().post('/v1/me/addresses').set(c.headers).send({ label: 'home', line: `${phone.slice(-3)}, Dargamitta Main Road`, location: centre }).expect(201);
    const items = (await http().get(`/v1/stores/${kirana.id}?lat=${centre.lat}&lng=${centre.lng}`).expect(200)).body.items as Array<{ id: string; name: string; variants: Array<{ id: string }> }>;
    const atta = items.find((x) => x.name === 'Annapoorna Chakki Atta')!;
    await http().put('/v1/cart').set(c.headers).send({ merchantId: kirana.id, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0]!.id, quantity: 2 }] }).expect(200);
    const q = (await http().post('/v1/cart/price').set(c.headers).send({ addressId: a.body.id, when: { mode: 'asap' } }).expect(200)).body;
    return (await http().post('/v1/orders').set(c.headers).set('Idempotency-Key', `push-${Date.now()}-${++seq}`).send({ quoteId: q.quoteId, paymentMethod: 'cod' }).expect(201)).body as { id: string; code: string };
  }
  const comms = async (orderId: string) => (await http().get(`/v1/ops/orders/${orderId}`).set(ops).expect(200)).body.comms as Array<{ channel: string; template: string; status: string; error: string | null }>;

  beforeAll(async () => {
    fake = await bootFakeApp();
    push = fake.app.get(PushProvider) as MockPushProvider;
    owner = await fake.signIn(kirana.ownerPhone.replace('+91', ''), 'merchant', DEVICE);
    await http().patch('/v1/merchants/me').set(owner.headers).send({ hours: everyDay('00:00', '23:59') }).expect(200);
    await http().put('/v1/merchants/me/availability').set(owner.headers).send({ open: true }).expect(200);
    ops = (await fake.opsSignIn()).headers;
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: a registered partner phone rings for a new order (urgent, with the order id)', async () => {
    await http().put('/v1/me/push-token').set(owner.headers).send({ token: 'fcm-token-partner-phone-1', platform: 'android' }).expect(204);
    const o = await placeOrder('9876501001');
    const sent = push.sent.filter((m) => m.token === 'fcm-token-partner-phone-1');
    expect(sent.at(-1)).toMatchObject({ urgent: true, data: { kind: 'new_order', orderId: o.id, code: o.code } });
    expect((await comms(o.id)).some((c) => c.channel === 'push' && c.template === 'merchant.new_order' && c.status === 'sent')).toBe(true);
  });

  it('signing out removes the phone: the next order is not pushed there', async () => {
    await http().delete('/v1/me/push-token').set(owner.headers).expect(204);
    const before = push.sent.length;
    const o = await placeOrder('9876501002');
    expect(push.sent.slice(before).some((m) => m.token === 'fcm-token-partner-phone-1')).toBe(false);
    expect((await comms(o.id)).find((c) => c.channel === 'push' && c.template === 'merchant.new_order')).toMatchObject({ status: 'skipped', error: 'no_token' });
  });

  it('a token is per phone: another person signing in on it takes it over; validation', async () => {
    await http().put('/v1/me/push-token').set(owner.headers).send({ token: 'fcm-token-partner-phone-1', platform: 'android' }).expect(204);
    const other = await fake.signIn('9876501003', 'consumer', DEVICE);
    await http().put('/v1/me/push-token').set(other.headers).send({ token: 'fcm-token-partner-phone-1', platform: 'android' }).expect(204);
    const before = push.sent.length;
    await placeOrder('9876501004');
    expect(push.sent.slice(before).some((m) => m.token === 'fcm-token-partner-phone-1' && m.data.kind === 'new_order')).toBe(false); // now the customer's phone
    await http().put('/v1/me/push-token').set(owner.headers).send({ token: 'short', platform: 'android' }).expect(400);
    await http().put('/v1/me/push-token').send({ token: 'fcm-token-partner-phone-1', platform: 'android' }).expect(401);
  });
});
