import { describe, expect, it } from 'vitest';
import { CloudWhatsAppOtpProvider, WhatsAppSendError } from './whatsapp-otp.provider';

const ENV = {
  WHATSAPP_ACCESS_TOKEN: 'EAAtest',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_OTP_TEMPLATE: 'santha_login_otp',
  WHATSAPP_API_VERSION: 'v23.0',
  WHATSAPP_GRAPH_URL: 'https://graph.example.test',
  WHATSAPP_TIMEOUT_MS: 1000,
};

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const body = (c: Call) => JSON.parse(c.init.body as string);

describe('CloudWhatsAppOtpProvider', () => {
  it('posts the authentication template with the code in the body and the copy-code button', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { messages: [{ id: 'wamid.x' }] } }]);
    await new CloudWhatsAppOtpProvider(ENV, fn).sendOtp('+919876543210', '482913', 'te');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://graph.example.test/v23.0/1234567890/messages');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer EAAtest');
    expect(body(calls[0]!)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'template',
      template: {
        name: 'santha_login_otp',
        language: { code: 'te' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
        ],
      },
    });
  });

  it('retries in English when the Telugu translation is missing (Meta 132001)', async () => {
    const { fn, calls } = fakeFetch([
      { status: 404, body: { error: { code: 132001, message: 'Template name does not exist in the translation' } } },
      { status: 200, body: {} },
    ]);
    await new CloudWhatsAppOtpProvider(ENV, fn).sendOtp('+919876543210', '482913', 'te');
    expect(calls.map((c) => body(c).template.language.code)).toEqual(['te', 'en']);
  });

  it('turns Meta errors into WhatsAppSendError with the Meta code (no retry)', async () => {
    const { fn, calls } = fakeFetch([{ status: 400, body: { error: { code: 131026, message: 'Message undeliverable' } } }]);
    const err = await new CloudWhatsAppOtpProvider(ENV, fn).sendOtp('+919876543210', '482913', 'en').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppSendError);
    expect((err as WhatsAppSendError).code).toBe(131026);
    expect(calls).toHaveLength(1);
  });

  it('network failures become WhatsAppSendError too', async () => {
    const fn = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(new CloudWhatsAppOtpProvider(ENV, fn).sendOtp('+919876543210', '1', 'en')).rejects.toBeInstanceOf(WhatsAppSendError);
  });
});
