import { Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Delivered to the app as FCM data (order id, kind…), strings only. */
  data: Record<string, string>;
  /** High priority + alarm channel: the merchant "new order" alert that must ring. */
  urgent: boolean;
}

export interface PushResult {
  ok: boolean;
  /** The token is dead (uninstalled app): stop using it. */
  invalidToken?: boolean;
  error?: string;
}

/** Push notifications port: FCM (HTTP v1) in staging/production, a recording mock in dev and tests. */
export abstract class PushProvider {
  abstract readonly name: string;
  abstract send(m: PushMessage): Promise<PushResult>;
}

export class MockPushProvider extends PushProvider {
  readonly name = 'mock';
  readonly sent: PushMessage[] = [];
  private readonly logger = new Logger('MockPush');

  async send(m: PushMessage): Promise<PushResult> {
    this.sent.push(m);
    this.logger.log(`push → ${m.token.slice(0, 12)}… ${m.title}: ${m.body}`);
    return { ok: true };
  }
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * FCM HTTP v1 with a service-account OAuth token (RS256 JWT → oauth2.googleapis.com), cached until
 * shortly before expiry. Urgent messages use high priority and the merchant app's alarm channel.
 */
export class FcmPushProvider extends PushProvider {
  readonly name = 'fcm';
  private readonly logger = new Logger('FCM');
  private readonly sa: ServiceAccount;
  private token: { value: string; exp: number } | null = null;

  constructor(serviceAccountJsonBase64: string) {
    super();
    this.sa = JSON.parse(Buffer.from(serviceAccountJsonBase64, 'base64').toString('utf8')) as ServiceAccount;
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.exp - 60 > now) return this.token.value;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.sa.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !j.access_token) throw new Error(`token status ${res.status}`);
    this.token = { value: j.access_token, exp: now + (j.expires_in ?? 3600) };
    return j.access_token;
  }

  async send(m: PushMessage): Promise<PushResult> {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.accessToken()}` },
        body: JSON.stringify({
          message: {
            token: m.token,
            notification: { title: m.title, body: m.body },
            data: m.data,
            android: { priority: m.urgent ? 'HIGH' : 'NORMAL', notification: m.urgent ? { channel_id: 'orders_alarm', sound: 'order_alert' } : undefined },
            apns: m.urgent ? { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'order_alert.caf' } } } : undefined,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, invalidToken: res.status === 404 || body.includes('UNREGISTERED'), error: `status ${res.status}` };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'FCM send failed');
      return { ok: false, error: (err as Error).message };
    }
  }
}
