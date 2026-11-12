import { Inject, Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '../../common/pii';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SmsProvider, type SmsLocale } from '../../infra/providers/sms/sms.provider';
import { WhatsAppOtpProvider, WhatsAppSendError } from '../../infra/providers/whatsapp/whatsapp-otp.provider';
import { FlagsService } from '../analytics-config/flags.service';

export type OtpChannel = 'whatsapp' | 'sms';

export interface OtpDeliveryPlan {
  /** Channels to try, in order. */
  channels: OtpChannel[];
  /** True when every channel in the plan is a mock, so the fixed MOCK_OTP_CODE may be used. */
  allMock: boolean;
}

/**
 * Decides how a login OTP travels and sends it. With the `whatsapp_otp` flag on, WhatsApp (Meta Cloud API) is
 * tried first and SMS is the fallback, so a number without WhatsApp can still sign in. With the flag off, SMS only.
 * In production a mock WhatsApp provider is never used, even with the flag on.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    private readonly sms: SmsProvider,
    private readonly whatsapp: WhatsAppOtpProvider,
    private readonly flags: FlagsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** `deviceId` keys the flag evaluation (no user exists before sign-in), so PostHog % rollouts stay stable. */
  async plan(deviceId: string): Promise<OtpDeliveryPlan> {
    const flagOn = await this.flags.isEnabled('whatsapp_otp', { distinctId: `device:${deviceId}` });
    const whatsappUsable = flagOn && !(this.env.APP_ENV === 'production' && this.whatsapp.name === 'mock');
    if (flagOn && !whatsappUsable) this.logger.warn('whatsapp_otp is on but WHATSAPP_PROVIDER=mock in production; using SMS');
    // OTP_PROVIDER=none has no SMS to fall back on (ADR-041): WhatsApp is the only channel.
    const smsFallback = this.sms.name !== 'none';
    const channels: OtpChannel[] = whatsappUsable ? (smsFallback ? ['whatsapp', 'sms'] : ['whatsapp']) : ['sms'];
    const allMock = channels.every((c) => (c === 'whatsapp' ? this.whatsapp.name === 'mock' : this.sms.name === 'mock'));
    return { channels, allMock };
  }

  /** Sends on the first channel that works and returns it. Throws the last channel's error if all fail. */
  async send(plan: OtpDeliveryPlan, phone: string, code: string, locale: SmsLocale): Promise<OtpChannel> {
    let lastErr: unknown;
    for (const channel of plan.channels) {
      try {
        if (channel === 'whatsapp') await this.whatsapp.sendOtp(phone, code, locale);
        else await this.sms.sendOtp(phone, code, locale);
        this.logger.log({ phone: maskPhone(phone), channel, fallback: channel !== plan.channels[0] }, 'OTP sent');
        return channel;
      } catch (err) {
        lastErr = err;
        const metaCode = err instanceof WhatsAppSendError ? err.code : undefined;
        this.logger.warn({ phone: maskPhone(phone), channel, metaCode, err: (err as Error).message }, 'OTP channel failed');
      }
    }
    throw lastErr;
  }
}
