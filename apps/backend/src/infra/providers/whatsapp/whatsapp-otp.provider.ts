import { Logger } from '@nestjs/common';
import { maskPhone } from '../../../common/pii';
import type { Env } from '../../../config/env';
import type { SmsLocale } from '../sms/sms.provider';

/**
 * Login OTPs over WhatsApp (Meta WhatsApp Cloud API). Implementations: `mock` (dev, tests, fake mode) and
 * `cloud` (live). Selected by WHATSAPP_PROVIDER and used only while the `whatsapp_otp` flag is on; callers fall
 * back to SMS when sending fails. Never throws a provider message to clients: errors are WhatsAppSendError.
 */
export abstract class WhatsAppOtpProvider {
  abstract readonly name: 'mock' | 'cloud';
  abstract sendOtp(phone: string, code: string, locale: SmsLocale): Promise<void>;
}

/** A failed WhatsApp send. `code` is Meta's error code when there is one (e.g. 131026 = not deliverable). */
export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}

/** Records messages and logs the code. Dev/test only: the OTP router never uses it in production. */
export class MockWhatsAppOtpProvider extends WhatsAppOtpProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockWhatsAppOtp');
  readonly sent: Array<{ phone: string; code: string; locale: SmsLocale; at: Date }> = [];
  /** Phones that behave like numbers without WhatsApp (tests the SMS fallback). */
  readonly undeliverable = new Set<string>();

  async sendOtp(phone: string, code: string, locale: SmsLocale): Promise<void> {
    if (this.undeliverable.has(phone)) throw new WhatsAppSendError('Message undeliverable', 131026);
    this.sent.push({ phone, code, locale, at: new Date() });
    if (this.sent.length > 1000) this.sent.shift();
    this.logger.log(`[mock-whatsapp] OTP for ${maskPhone(phone)} is ${code}`);
  }

  lastCodeFor(phone: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.phone === phone)?.code;
  }
}

/** Meta language codes for our locales. The template must be approved in both. */
const LANGUAGE: Record<SmsLocale, string> = { en: 'en', te: 'te' };
/** "Template name does not exist in the translation": retry in English. */
const MISSING_TRANSLATION = 132001;

type Fetch = typeof fetch;

/**
 * Live sender: POST {graph}/{version}/{phone-number-id}/messages with an authentication template. Meta requires
 * the code twice: once for the body {{1}} and once for the copy-code (URL) button.
 * https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates
 */
export class CloudWhatsAppOtpProvider extends WhatsAppOtpProvider {
  readonly name = 'cloud';
  private readonly logger = new Logger('WhatsAppCloudOtp');

  constructor(
    private readonly env: Pick<
      Env,
      'WHATSAPP_ACCESS_TOKEN' | 'WHATSAPP_PHONE_NUMBER_ID' | 'WHATSAPP_OTP_TEMPLATE' | 'WHATSAPP_API_VERSION' | 'WHATSAPP_GRAPH_URL' | 'WHATSAPP_TIMEOUT_MS'
    >,
    private readonly fetchFn: Fetch = fetch,
  ) {
    super();
  }

  async sendOtp(phone: string, code: string, locale: SmsLocale): Promise<void> {
    try {
      await this.post(phone, code, LANGUAGE[locale]);
    } catch (err) {
      if (err instanceof WhatsAppSendError && err.code === MISSING_TRANSLATION && locale !== 'en') {
        this.logger.warn(`Template ${this.env.WHATSAPP_OTP_TEMPLATE} has no '${LANGUAGE[locale]}' translation; sending in English`);
        await this.post(phone, code, LANGUAGE.en);
        return;
      }
      throw err;
    }
  }

  /** The request body, exported for tests and docs. `to` is the number without "+". */
  static body(phone: string, code: string, template: string, language: string) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    };
  }

  private async post(phone: string, code: string, language: string): Promise<void> {
    const url = `${this.env.WHATSAPP_GRAPH_URL}/${this.env.WHATSAPP_API_VERSION}/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(CloudWhatsAppOtpProvider.body(phone, code, this.env.WHATSAPP_OTP_TEMPLATE, language)),
        signal: AbortSignal.timeout(this.env.WHATSAPP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new WhatsAppSendError(`WhatsApp request failed: ${(err as Error).name}`);
    }
    if (res.ok) return;
    let metaCode: number | undefined;
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { code?: number; message?: string } };
      metaCode = j.error?.code;
      if (j.error?.message) message = `${message}: ${j.error.message}`;
    } catch {
      /* non-JSON error body */
    }
    throw new WhatsAppSendError(message, metaCode);
  }
}
