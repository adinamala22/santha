/**
 * Pre-launch mode (ADR-024, fake mode with LAUNCH_STAGE=prelaunch, OPS_LOGIN_OTP=off):
 * - the website works: site config, lead forms, public store pages;
 * - the ops console signs in on password only and reads the leads;
 * - everything the apps use answers 503 PRELAUNCH.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_OPS_PASSWORD } from '../../src/dev/seed-data';
import { bootFakeApp, type FakeApp } from './harness';

describe('Pre-launch production mode (fake mode)', () => {
  let fake: FakeApp;
  const http = () => fake.http();

  beforeAll(async () => {
    fake = await bootFakeApp({ LAUNCH_STAGE: 'prelaunch', OPS_LOGIN_OTP: 'off' });
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: the website works: site config, leads, store pages', async () => {
    expect((await http().get('/v1/config/site').expect(200)).body).toMatchObject({ appDownloads: false });
    await http().post('/v1/leads').send({ kind: 'customer', name: 'Early Bird', phone: '9876504001' }).expect(201);
    await http().post('/v1/leads').send({ kind: 'store', name: 'Ravi', phone: '9876504002', business: 'Ravi Kirana', category: 'kirana' }).expect(201);
    await http().get('/v1/public/stores').expect(200);
    await http().get('/v1/health/ready').expect(200);
  });

  it('the ops console signs in on password only and sees the leads', async () => {
    const deviceId = 'ops-console-prelaunch';
    const login = (await http().post('/v1/auth/ops/login').send({ email: 'admin@santha.local', password: SEED_OPS_PASSWORD, deviceId }).expect(200)).body;
    expect(login).toMatchObject({ signedIn: true, accessToken: expect.any(String), refreshToken: expect.any(String), user: { roles: expect.arrayContaining(['admin']) } });
    expect(login.challengeId).toBeUndefined();
    const headers = { Authorization: `Bearer ${login.accessToken}`, 'X-Device-Id': deviceId };
    const leads = (await http().get('/v1/ops/leads').set(headers).expect(200)).body.items as Array<{ name: string; kind: string }>;
    expect(leads.map((l) => l.name)).toEqual(expect.arrayContaining(['Early Bird', 'Ravi']));
    // A wrong password is still refused.
    await http().post('/v1/auth/ops/login').send({ email: 'admin@santha.local', password: 'not-the-password', deviceId }).expect(401);
  });

  it('everything the apps use answers 503 PRELAUNCH', async () => {
    for (const [method, path] of [
      ['post', '/v1/auth/otp/request'],
      ['get', '/v1/feed?lat=14.4525&lng=79.995'],
      ['put', '/v1/cart'],
      ['post', '/v1/orders'],
      ['get', '/v1/merchants/me'],
    ] as const) {
      const r = await http()[method](path).send({});
      expect(r.status, path).toBe(503);
      expect(r.body.error.code, path).toBe('PRELAUNCH');
    }
  });
});
