/**
 * DATA_STORE=memory boots the real app with no overrides and no Docker: health reports the fake
 * store, seeded demo users can sign in with the fixed mock code, and new numbers register.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.factory';
import { AppModule } from '../../src/app.module';
import { SEED_PEOPLE } from '../../src/dev/seed-data';

const DEVICE = 'fake-mode-device-01';
const saved = { ...process.env };

async function signIn(http: () => request.Agent, phone: string, app: string) {
  const req = await http().post('/v1/auth/otp/request').send({ phone, deviceId: DEVICE, app }).expect(200);
  return http()
    .post('/v1/auth/otp/verify')
    .send({ challengeId: req.body.challengeId, code: '123456', deviceId: DEVICE, app, platform: 'android' })
    .expect(200);
}

describe('fake mode (DATA_STORE=memory)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer()) as unknown as request.Agent;

  beforeAll(async () => {
    process.env.DATA_STORE = 'memory';
    process.env.MOCK_OTP_CODE = '123456';
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('reports ready without Postgres or Redis', async () => {
    const res = await http().get('/v1/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.postgres.detail).toMatch(/in-memory fake/);
  });

  it('signs in seeded users with their seeded roles', async () => {
    const merchant = SEED_PEOPLE.find((p) => p.roles.includes('merchant'))!;
    const ok = await signIn(http, merchant.phone.slice(3), 'merchant');
    expect(ok.body).toMatchObject({ isNewUser: false, user: { name: merchant.name, roles: ['merchant'] } });

    const me = await http()
      .get('/v1/me')
      .set({ Authorization: `Bearer ${ok.body.accessToken}`, 'X-Device-Id': DEVICE })
      .expect(200);
    expect(me.body.roles).toEqual(['merchant']);
  });

  it('registers a new number with the role for the app', async () => {
    const ok = await signIn(http, '9876512345', 'consumer');
    expect(ok.body).toMatchObject({ isNewUser: true, user: { roles: ['consumer'] } });
  });
});
