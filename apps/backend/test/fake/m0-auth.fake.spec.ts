/**
 * M0 acceptance in fake mode (DATA_STORE=memory): the API is ready without Postgres/Redis, and
 * OTP login works for every app with seeded and brand-new numbers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootFakeApp, type FakeApp } from './harness';

describe('M0 · auth in fake mode', () => {
  let fake: FakeApp;

  beforeAll(async () => {
    fake = await bootFakeApp();
  });

  afterAll(async () => {
    await fake.close();
  });

  it('reports ready without Postgres or Redis', async () => {
    const res = await fake.http().get('/v1/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.postgres.detail).toMatch(/in-memory fake/);
  });

  it.each([
    ['consumer', 'consumer'],
    ['merchant', 'merchant'],
    ['rider', 'rider'],
  ] as const)('seeded %s signs in from the %s app with their seeded role', async (role, app) => {
    const person = fake.seeded(role);
    const s = await fake.signIn(person.phone, app);
    expect(s).toMatchObject({ isNewUser: false, user: { name: person.name, roles: [role] } });

    const me = await fake.http().get('/v1/me').set(s.headers).expect(200);
    expect(me.body.roles).toEqual([role]);
  });

  it('registers a new number with the role of the app', async () => {
    const s = await fake.signIn('9876512345', 'consumer');
    expect(s).toMatchObject({ isNewUser: true, user: { roles: ['consumer'] } });
  });

  it('refresh rotates tokens and logout ends the session', async () => {
    const s = await fake.signIn(fake.seeded('consumer').phone, 'consumer');
    const ref = await fake.http().post('/v1/auth/refresh').send({ refreshToken: s.refreshToken, deviceId: s.deviceId }).expect(200);
    expect(ref.body.refreshToken).not.toBe(s.refreshToken);

    await fake
      .http()
      .post('/v1/auth/logout')
      .set({ Authorization: `Bearer ${ref.body.accessToken}`, 'X-Device-Id': s.deviceId })
      .expect(204);
    await fake.http().post('/v1/auth/refresh').send({ refreshToken: ref.body.refreshToken, deviceId: s.deviceId }).expect(401);
  });

  it('OTP resend cooldown still applies when real limits are configured', async () => {
    const strict = await bootFakeApp({ OTP_RESEND_COOLDOWN_SEC: '30' });
    try {
      const phone = strict.seeded('consumer').phone.slice(3);
      await strict.http().post('/v1/auth/otp/request').send({ phone, deviceId: 'cooldown-01', app: 'consumer' }).expect(200);
      const again = await strict
        .http()
        .post('/v1/auth/otp/request')
        .send({ phone, deviceId: 'cooldown-01', app: 'consumer' })
        .expect(429);
      expect(again.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await strict.close();
    }
  });

  it('ops roles cannot be self-granted: OTP sign-in is only for the three apps', async () => {
    const res = await fake
      .http()
      .post('/v1/auth/otp/request')
      .send({ phone: fake.seeded('admin').phone.slice(3), deviceId: 'ops-console-01', app: 'ops' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
