import { Logger } from '@nestjs/common';

export type MessageChannel = 'sms' | 'whatsapp' | 'voice';

export interface SentMessage {
  channel: MessageChannel;
  to: string;
  text: string;
  /** DLT / WhatsApp template id the text was rendered from. */
  template: string;
}

/**
 * Transactional messages beyond push: SMS (MSG91, DLT templates), WhatsApp Business (Meta Cloud API /
 * BSP, opt-in only) and an automated voice call (Exotel) for merchants who miss a new-order alert.
 * Dev, tests and fake mode use the recording mock; never live providers outside staging/production.
 */
export abstract class MessagingProvider {
  abstract readonly name: string;
  abstract send(m: SentMessage): Promise<{ ok: boolean; error?: string }>;
}

export class MockMessagingProvider extends MessagingProvider {
  readonly name = 'mock';
  readonly sent: SentMessage[] = [];
  private readonly logger = new Logger('MockMessaging');

  async send(m: SentMessage): Promise<{ ok: boolean }> {
    this.sent.push(m);
    this.logger.log(`${m.channel} → ${m.to.slice(0, 5)}…: ${m.text}`);
    return { ok: true };
  }
}
