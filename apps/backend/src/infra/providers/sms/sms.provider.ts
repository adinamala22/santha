import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '../../../common/pii';
import { DomainError } from '../../../common/errors/domain-error';

export type SmsLocale = 'en' | 'te';

/**
 * SMS/OTP provider port. Implementations: `mock` (dev/test) and `msg91` (live).
 * Selected by OTP_PROVIDER; dev and test never reach a live provider.
 */
export abstract class SmsProvider {
  abstract readonly name: string;
  abstract sendOtp(phone: string, code: string, locale: SmsLocale): Promise<void>;
}

/** Records messages in memory and logs the code (dev only — the mock never runs in production). */
@Injectable()
export class MockSmsProvider extends SmsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockSmsProvider');
  readonly sent: Array<{ phone: string; code: string; locale: SmsLocale; at: Date }> = [];

  async sendOtp(phone: string, code: string, locale: SmsLocale): Promise<void> {
    this.sent.push({ phone, code, locale, at: new Date() });
    if (this.sent.length > 1000) this.sent.shift();
    this.logger.log(`[mock-sms] OTP for ${maskPhone(phone)} is ${code}`);
  }

  lastCodeFor(phone: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.phone === phone)?.code;
  }
}

/**
 * MSG91 OTP (live). Not wired in M0 — credentials and DLT template approval are a launch task.
 * Throws a typed error so a misconfigured env fails loudly instead of silently not sending.
 */
@Injectable()
export class Msg91SmsProvider extends SmsProvider {
  readonly name = 'msg91';

  async sendOtp(): Promise<void> {
    throw new DomainError('PROVIDER_UNAVAILABLE', 'SMS provider is not available. Please try again later.');
  }
}
