/**
 * SOS also goes to the on-call Telegram group (ADR-043), fake mode. Telegram is stubbed at fetch: no network.
 *  - with OPS_ALERT_TELEGRAM_* set and no phones, an SOS posts the page text to the group and the console counts it;
 *  - a Telegram failure does not stop the SOS.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;

describe('SOS pages the Telegram group (ADR-043, fake mode)', () => {
  let fake: FakeApp;
  let rider: Session;
  let ops: Session['headers'];
  const calls: Array<{ url: string; body: { chat_id: string; text: string } }> = [];
  let telegramOk = true;
  const realFetch = globalThis.fetch;
  const http = () => fake.http();

  beforeAll(async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: telegramOk ? 200 : 500 });
    }) as typeof fetch;
    fake = await bootFakeApp({ OPS_ALERT_PHONES: '', OPS_ALERT_TELEGRAM_BOT_TOKEN: 'test-bot-token', OPS_ALERT_TELEGRAM_CHAT_ID: '-100123' });
    ops = (await fake.opsSignIn()).headers;
    rider = await fake.signIn('9000000101', 'rider');
    await http().post('/v1/riders/me/location').set(rider.headers).send({ lat: centre.lat, lng: centre.lng }).expect(204);
  }, 60_000);
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await fake?.close();
  });

  const openSos = async () => (await http().get(`/v1/ops/riders/${rider.user.id}`).set(ops).expect(200)).body.openSos as { id: string; paging: { phones: number; reached: number } } | null;

  it('an SOS posts the page to the group, and the console counts the group as reached', async () => {
    await http().post('/v1/riders/me/sos').set(rider.headers).send({}).expect(200);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });
    expect(calls[0]!.url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
    expect(calls[0]!.body.chat_id).toBe('-100123');
    expect(calls[0]!.body.text).toContain('Demo Rider 1');
    await vi.waitFor(async () => expect((await openSos())?.paging).toMatchObject({ phones: 1, reached: 1 }), { timeout: 5000 });
    const sos = (await openSos())!;
    await http().post(`/v1/ops/sos/${sos.id}/resolve`).set(ops).send({ note: 'ok' }).expect(200);
  });

  it('a Telegram failure does not stop the SOS: it is still raised and counted as not reached', async () => {
    telegramOk = false;
    await http().post('/v1/riders/me/sos').set(rider.headers).send({}).expect(200);
    await vi.waitFor(async () => expect((await openSos())?.paging).toMatchObject({ phones: 1, reached: 0 }), { timeout: 5000 });
  });
});
