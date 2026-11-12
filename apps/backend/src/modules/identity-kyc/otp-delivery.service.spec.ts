import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../config/env';
import { MockSmsProvider, NoSmsProvider } from '../../infra/providers/sms/sms.provider';
import { MockWhatsAppOtpProvider, WhatsAppOtpProvider, WhatsAppSendError } from '../../infra/providers/whatsapp/whatsapp-otp.provider';
import { FlagsService } from '../analytics-config/flags.service';
import { OtpDeliveryService } from './otp-delivery.service';

const PHONE = '+919876543210';

/** A non-mock WhatsApp provider for plan tests (never calls Meta). */
class FakeCloud extends WhatsAppOtpProvider {
  readonly name = 'cloud' as const;
  fail: WhatsAppSendError | null = null;
  sent = 0;
  async sendOtp(): Promise<void> {
    if (this.fail) throw this.fail;
    this.sent++;
  }
}

function setup(env: Record<string, string>, whatsapp: WhatsAppOtpProvider = new MockWhatsAppOtpProvider()) {
  const e = parseEnv({ ...process.env, ...env });
  const sms = new MockSmsProvider();
  return { sms, whatsapp, svc: new OtpDeliveryService(sms, whatsapp, new FlagsService(e), e) };
}

const ON = { FLAG_OVERRIDES: '{"whatsapp_otp":true}' };

describe('OtpDeliveryService', () => {
  it('flag on by default: WhatsApp first', async () => {
    const { svc } = setup({});
    expect((await svc.plan('d1')).channels).toEqual(['whatsapp', 'sms']);
  });

  it('flag off: SMS only', async () => {
    const { svc } = setup({ FLAG_OVERRIDES: '{"whatsapp_otp":false}' });
    expect(await svc.plan('d1')).toEqual({ channels: ['sms'], allMock: true });
  });

  it('flag on: WhatsApp first, SMS as fallback', async () => {
    const { svc } = setup(ON);
    expect(await svc.plan('d1')).toEqual({ channels: ['whatsapp', 'sms'], allMock: true });
  });

  it('a live WhatsApp provider means a real code (no fixed mock code)', async () => {
    const { svc } = setup(ON, new FakeCloud());
    expect((await svc.plan('d1')).allMock).toBe(false);
  });

  it('production never uses the mock WhatsApp provider, even with the flag on', async () => {
    const { svc } = setup({
      ...ON,
      APP_ENV: 'production',
      OTP_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'k',
      MSG91_TEMPLATE_ID: 't',
      KYC_PROVIDER: 'digio',
      PAYMENTS_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'k',
      RAZORPAY_KEY_SECRET: 's',
      RAZORPAY_WEBHOOK_SECRET: 'w',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
    });
    expect((await svc.plan('d1')).channels).toEqual(['sms']);
  });

  it('falls back to SMS when WhatsApp fails, and reports sms', async () => {
    const cloud = new FakeCloud();
    cloud.fail = new WhatsAppSendError('Message undeliverable', 131026);
    const { svc, sms } = setup(ON, cloud);
    const plan = await svc.plan('d1');
    expect(await svc.send(plan, PHONE, '482913', 'en')).toBe('sms');
    expect(sms.lastCodeFor(PHONE)).toBe('482913');
  });

  it('WhatsApp success: SMS is not sent', async () => {
    const cloud = new FakeCloud();
    const { svc, sms } = setup(ON, cloud);
    expect(await svc.send(await svc.plan('d1'), PHONE, '482913', 'en')).toBe('whatsapp');
    expect(cloud.sent).toBe(1);
    expect(sms.sent).toHaveLength(0);
  });

  it('when every channel fails, the last error is thrown', async () => {
    const cloud = new FakeCloud();
    cloud.fail = new WhatsAppSendError('down');
    const { svc, sms } = setup(ON, cloud);
    sms.sendOtp = async () => {
      throw new Error('sms down');
    };
    await expect(svc.send(await svc.plan('d1'), PHONE, '482913', 'en')).rejects.toThrow('sms down');
  });
  it('ADR-041: with no SMS provider WhatsApp is the only channel, and a failure is reported, not hidden', async () => {
    const cloud = new FakeCloud();
    const e = parseEnv({ ...process.env, ...ON });
    const svc = new OtpDeliveryService(new NoSmsProvider(), cloud, new FlagsService(e), e);
    const plan = await svc.plan('d1');
    expect(plan).toEqual({ channels: ['whatsapp'], allMock: false });
    expect(await svc.send(plan, PHONE, '482913', 'en')).toBe('whatsapp');
    cloud.fail = new WhatsAppSendError('Message undeliverable', 131026);
    await expect(svc.send(plan, PHONE, '482913', 'en')).rejects.toThrow('undeliverable');
  });
});
