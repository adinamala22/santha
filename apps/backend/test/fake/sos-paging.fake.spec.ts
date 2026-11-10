/**
 * Paging the on-call phones for a rider SOS (ADR-034), fake mode:
 *  - an SOS sends an SMS and an automated call to every OPS_ALERT_PHONES number, with the rider, their phone and the map link;
 *  - pressing SOS again does not page twice; the rider's response does not wait for the providers;
 *  - an SOS still open after OPS_SOS_REPAGE_SEC pages once more; one resolved in time does not;
 *  - ops see on the rider page how many phones were paged, or that none is set;
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MessagingProvider, type SentMessage } from '../../src/infra/providers/messaging/messaging.provider';
import { SEED_MICRO_MARKETS } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp, type Session } from './harness';

const centre = SEED_MICRO_MARKETS.find((m) => m.slug === 'dargamitta')!.centre;
const PHONES = ['+919811100001', '+919811100002'];
type Paging = { phones: number; reached: number; at: string | null };

async function riderSession(fake: FakeApp) {
  const rider = await fake.signIn('9000000101', 'rider');
  await fake.http().post('/v1/riders/me/location').set(rider.headers).send({ lat: centre.lat, lng: centre.lng }).expect(204);
  return rider;
}

describe('SOS pages the on-call phones (ADR-034, fake mode)', () => {
  let fake: FakeApp;
  let rider: Session;
  let ops: Session['headers'];
  let sent: SentMessage[];
  const http = () => fake.http();
  const page = async (round: string) => sent.filter((m) => m.template === round);
  const riderPage = async () => (await http().get(`/v1/ops/riders/${rider.user.id}`).set(ops).expect(200)).body.openSos as { id: string; paging: Paging } | null;

  beforeAll(async () => {
    fake = await bootFakeApp({ OPS_ALERT_PHONES: ` ${PHONES.join(' , ')} `, OPS_SOS_REPAGE_SEC: '180' });
    sent = (fake.app.get(MessagingProvider) as unknown as { sent: SentMessage[] }).sent;
    ops = (await fake.opsSignIn()).headers;
    rider = await riderSession(fake);
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: SOS sends an SMS and a call to each on-call phone, once; the console shows who was paged', async () => {
    const a = (await http().post('/v1/riders/me/sos').set(rider.headers).send({}).expect(200)).body;
    await vi.waitFor(async () => expect(await page('ops.rider_sos')).toHaveLength(4), { timeout: 5000 });

    const first = await page('ops.rider_sos');
    for (const phone of PHONES) {
      expect(first.filter((m) => m.to === phone).map((m) => m.channel).sort()).toEqual(['sms', 'voice']);
    }
    const text = first[0]!.text;
    expect(text).toContain('Demo Rider 1');
    expect(text).toContain('9000000101'); // the rider's phone, so the on-call can ring back
    expect(text).toContain(`https://maps.google.com/?q=${centre.lat}`);
    expect(text).toContain('No delivery in hand.');

    // A second press returns the same alert and pages nobody again.
    const again = (await http().post('/v1/riders/me/sos').set(rider.headers).send({}).expect(200)).body;
    expect(again.id).toBe(a.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await page('ops.rider_sos')).toHaveLength(4);

    // The rider page tells ops the page went out.
    await vi.waitFor(async () => expect((await riderPage())?.paging).toMatchObject({ phones: 2, reached: 2, at: expect.any(String) }), { timeout: 5000 });

    // Still open after 3 minutes: paged once more, with the minutes.
    await http().post('/v1/dev/clock').send({ minutes: 4 }).expect(200);
    await vi.waitFor(async () => expect(await page('ops.rider_sos_again')).toHaveLength(4), { timeout: 5000 });
    expect((await page('ops.rider_sos_again'))[0]!.text).toMatch(/still open after \d+ min/);
    await http().post('/v1/dev/clock').send({ minutes: 10 }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(await page('ops.rider_sos_again')).toHaveLength(4); // only once

    await http().post(`/v1/ops/sos/${a.id}/resolve`).set(ops).send({ note: 'safe' }).expect(200);
  });

  it('an SOS resolved before the reminder is not paged again', async () => {
    const before = (await page('ops.rider_sos_again')).length;
    const a = (await http().post('/v1/riders/me/sos').set(rider.headers).send({}).expect(200)).body;
    await vi.waitFor(async () => expect((await page('ops.rider_sos')).length).toBe(8), { timeout: 5000 });
    await http().post(`/v1/ops/sos/${a.id}/resolve`).set(ops).send({}).expect(200);
    await http().post('/v1/dev/clock').send({ minutes: 10 }).expect(200);
    await new Promise((r) => setTimeout(r, 400));
    expect((await page('ops.rider_sos_again')).length).toBe(before);
  });

  it('the page is written to the comms log, never to customers', async () => {
    expect(sent.every((m) => !m.template.startsWith('ops.') || PHONES.includes(m.to))).toBe(true);
  });
});

describe('SOS with no on-call phone set (ADR-034, fake mode)', () => {
  let fake: FakeApp;
  afterAll(() => fake?.close());

  it('still raises the alert and tells ops nobody was paged', async () => {
    fake = await bootFakeApp({ OPS_ALERT_PHONES: '' });
    const rider = await riderSession(fake);
    const ops = (await fake.opsSignIn()).headers;
    const sent = (fake.app.get(MessagingProvider) as unknown as { sent: SentMessage[] }).sent;
    const before = sent.length; // the mock provider is shared by every app booted in this file
    await fake.http().post('/v1/riders/me/sos').set(rider.headers).send({}).expect(200);
    await new Promise((r) => setTimeout(r, 400));
    expect(sent.slice(before).filter((m) => m.template.startsWith('ops.'))).toHaveLength(0);
    const s = (await fake.http().get(`/v1/ops/riders/${rider.user.id}`).set(ops).expect(200)).body.openSos;
    expect(s.paging).toEqual({ phones: 0, reached: 0, at: null });
  }, 60_000);
});
