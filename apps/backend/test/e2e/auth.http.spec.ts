/**
 * HTTP-level test of the OTP login flow through the real Nest pipeline (validation pipe, guard,
 * serializer, error filter) with in-memory storage — runs without Docker. The same flow against
 * real Postgres + Redis lives in test/integration/auth.int.spec.ts.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.factory';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { MockSmsProvider, SmsProvider } from '../../src/infra/providers/sms/sms.provider';
import { REDIS } from '../../src/infra/redis/redis.module';
import { IdentityRepository } from '../../src/modules/identity-kyc/identity.repository';
import { RateLimiter } from '../../src/modules/identity-kyc/rate-limiter';
import { InMemoryIdentityRepository, InMemoryRateLimiter } from '../mocks/in-memory-identity.repository';

const DEVICE = 'pixel-7a-install-42';

describe('auth over HTTP', () => {
  let app: INestApplication;
  const sms = new MockSmsProvider();
  const repo = new InMemoryIdentityRepository();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityRepository)
      .useValue(repo)
      .overrideProvider(RateLimiter)
      .useValue(new InMemoryRateLimiter())
      .overrideProvider(SmsProvider)
      .useValue(sms)
      .overrideProvider(PrismaService)
      .useValue({ $disconnect: async () => undefined })
      .overrideProvider(REDIS)
      .useValue({ quit: async () => 'OK' })
      .compile();
    app = mod.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('GET /v1/health is public', async () => {
    await http().get('/v1/health').expect(200, { status: 'ok' });
  });

  it('validates request bodies with a structured error', async () => {
    const res = await http().post('/v1/auth/otp/request').send({ phone: '98', app: 'ops' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(['deviceId', 'app']),
    );
  });

  it('full flow: request → verify → me → refresh → logout', async () => {
    const req1 = await http()
      .post('/v1/auth/otp/request')
      .send({ phone: '9876500001', deviceId: DEVICE, app: 'merchant', locale: 'te' })
      .expect(200);
    const code = sms.lastCodeFor('+919876500001')!;
    expect(sms.sent.at(-1)!.locale).toBe('te');

    const bad = await http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId: req1.body.challengeId, code: code === '000000' ? '111111' : '000000', deviceId: DEVICE, app: 'merchant', platform: 'android' })
      .expect(400);
    expect(bad.body.error).toMatchObject({ code: 'OTP_INVALID', details: { remainingAttempts: 4 } });

    const ok = await http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId: req1.body.challengeId, code, deviceId: DEVICE, app: 'merchant', platform: 'android', appVersion: '0.1.0' })
      .expect(200);
    expect(ok.body).toMatchObject({
      isNewUser: true,
      accessExpiresIn: 900,
      user: { phoneMasked: '+9198******01', roles: ['merchant'], locale: 'en', name: null },
    });
    expect(JSON.stringify(ok.body)).not.toContain('9876500001'); // never leak the raw phone

    const auth = { Authorization: `Bearer ${ok.body.accessToken}`, 'X-Device-Id': DEVICE };
    const me = await http().get('/v1/me').set(auth).expect(200);
    expect(me.body.roles).toEqual(['merchant']);

    await http().get('/v1/me').expect(401);
    const wrongDevice = await http().get('/v1/me').set({ ...auth, 'X-Device-Id': 'other-device-xx' }).expect(401);
    expect(wrongDevice.body.error.code).toBe('DEVICE_MISMATCH');

    const ref = await http().post('/v1/auth/refresh').send({ refreshToken: ok.body.refreshToken, deviceId: DEVICE }).expect(200);
    expect(ref.body.refreshToken).not.toBe(ok.body.refreshToken);

    await http().post('/v1/auth/logout').set({ Authorization: `Bearer ${ref.body.accessToken}`, 'X-Device-Id': DEVICE }).expect(204);
    const after = await http().post('/v1/auth/refresh').send({ refreshToken: ref.body.refreshToken, deviceId: DEVICE }).expect(401);
    expect(after.body.error.code).toBe('REFRESH_INVALID');
  });
});
