/**
 * WhatsApp login OTP in fake mode (ADR-017): with the `whatsapp_otp` flag on (the default), every login OTP (all three apps and
 * the ops console's second factor) is sent on WhatsApp and the API says so; with it off, SMS as before. Fake mode
 * always uses the mock WhatsApp provider, even if WHATSAPP_PROVIDER=cloud is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WhatsAppOtpProvider } from '../../src/infra/providers/whatsapp/whatsapp-otp.provider';
import { bootFakeApp, type FakeApp } from './harness';

describe('M0 · WhatsApp OTP (flag whatsapp_otp)', () => {
  describe('flag on (default, no override)', () => {
    let fake: FakeApp;
    beforeAll(async () => {
      fake = await bootFakeApp({
        // Must be ignored in fake mode: no live provider without Docker/credentials.
        WHATSAPP_PROVIDER: 'cloud',
        WHATSAPP_ACCESS_TOKEN: 'not-used',
        WHATSAPP_PHONE_NUMBER_ID: '1',
      });
    }, 60_000);
    afterAll(() => fake.close());

    it('fake mode uses the mock WhatsApp provider', () => {
      expect(fake.app.get(WhatsAppOtpProvider).name).toBe('mock');
    });

    it.each(['consumer', 'merchant', 'rider'] as const)('the %s app is told the code went on WhatsApp, and sign-in works', async (app) => {
      const res = await fake.http().post('/v1/auth/otp/request').send({ phone: '9876500111', deviceId: `wa-device-${app}-0001`, app }).expect(200);
      expect(res.body.channel).toBe('whatsapp');
      const s = await fake.signIn('9876500111', app);
      expect(s.accessToken).toBeTruthy();
    });

    it('the ops console second factor goes on WhatsApp too', async () => {
      const res = await fake
        .http()
        .post('/v1/auth/ops/login')
        .send({ email: 'admin@santha.local', password: process.env.SEED_OPS_PASSWORD ?? 'santha-admin-dev', deviceId: 'ops-console-wa-0001' })
        .expect(200);
      expect(res.body.channel).toBe('whatsapp');
      await expect(fake.opsSignIn()).resolves.toMatchObject({ user: { roles: expect.arrayContaining(['admin']) } });
    });
  });

  describe('flag off (kill switch)', () => {
    let fake: FakeApp;
    beforeAll(async () => {
      fake = await bootFakeApp({ FLAG_OVERRIDES: '{"whatsapp_otp":false}' });
    }, 60_000);
    afterAll(() => fake.close());

    it('the code goes by SMS and the API says sms', async () => {
      const res = await fake.http().post('/v1/auth/otp/request').send({ phone: '9876500112', deviceId: 'sms-device-0001', app: 'consumer' }).expect(200);
      expect(res.body.channel).toBe('sms');
    });
  });
});
