import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const root = resolve(__dirname, '../../../..');
const SECRETS = {
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
  DATABASE_URL: 'postgresql://santha:pw@db:5432/santha',
  REDIS_URL: 'redis://redis:6379',
  RAZORPAY_KEY_ID: 'rzp_live_x',
  RAZORPAY_KEY_SECRET: 's',
  RAZORPAY_WEBHOOK_SECRET: 'w',
  WHATSAPP_ACCESS_TOKEN: 't',
  FCM_SERVICE_ACCOUNT_B64: 'e30=',
  GOOGLE_MAPS_SERVER_KEY: 'k',
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 'b',
};

/** The live flip of go-live.md step 3: production values + the AWS overlay with its backend block replaced by the live one. */
describe('production goes live (docs/launch/go-live.md)', () => {
  const live = readFileSync(join(root, 'docs/launch/aws.prod.live.values.yaml.txt'), 'utf8');
  const overlay = readFileSync(join(root, 'config/values/aws.prod.values.yaml'), 'utf8');

  function dirWithLive(): string {
    const d = mkdtempSync(join(tmpdir(), 'santha-live-'));
    writeFileSync(join(d, 'prod.values.yaml'), readFileSync(join(root, 'config/values/prod.values.yaml'), 'utf8'));
    // Keep the overlay's storage lines, drop its pre-launch block, and add the live block.
    const storage = overlay.split('\n').filter((l) => /^\s+s3(Endpoint|Region|Bucket):/.test(l)).join('\n');
    const liveLines = live.split('\n').filter((l) => !l.startsWith('#') && !l.startsWith('backend:')).join('\n');
    writeFileSync(join(d, 'aws.prod.values.yaml'), `backend:\n${storage}\n${liveLines}\n`);
    return d;
  }

  it('boots with real-looking secrets: live stage, WhatsApp-only OTP, manual KYC, live payments, S3 on Amazon', () => {
    const env = parseEnv({ SANTHA_ENV: 'prod', SANTHA_CLOUD: 'aws', SANTHA_VALUES_DIR: dirWithLive(), ...SECRETS });
    expect(env).toMatchObject({
      APP_ENV: 'production',
      LAUNCH_STAGE: 'live',
      OTP_PROVIDER: 'none',
      KYC_PROVIDER: 'manual',
      PAYMENTS_PROVIDER: 'razorpay',
      WHATSAPP_PROVIDER: 'cloud',
      MAPS_PROVIDER: 'google',
      S3_ENDPOINT: 'https://s3.ap-south-1.amazonaws.com',
      S3_BUCKET: 'santha-prod-media',
    });
  });

  it('is refused without the secrets live needs', () => {
    const { RAZORPAY_KEY_SECRET: _omit, ...rest } = SECRETS;
    expect(() => parseEnv({ SANTHA_ENV: 'prod', SANTHA_CLOUD: 'aws', SANTHA_VALUES_DIR: dirWithLive(), ...rest })).toThrow(/RAZORPAY_KEY_SECRET/);
  });
});
