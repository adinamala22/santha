import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_KEYS, parseEnv } from './env';
import { valuesFor } from './values';

const SECRETS = {
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
  DATABASE_URL: 'postgresql://santha:pw@db:5432/santha',
  REDIS_URL: 'redis://redis:6379',
};

function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'santha-values-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

describe('values files (SANTHA_ENV / SANTHA_CLOUD)', () => {
  it('without SANTHA_ENV nothing is loaded (local dev and tests unchanged)', () => {
    expect(valuesFor({}, ENV_KEYS)).toEqual({});
  });

  it('base, then cloud overlay, then real environment variables win', () => {
    const d = dir({
      'prod.values.yaml': 'backend:\n  logLevel: info\n  s3Region: ap-south-1\n  trustProxy: 1\nweb:\n  siteUrl: https://x\n',
      'gcp.prod.values.yaml': 'backend:\n  s3Region: asia-south1\n',
    });
    const v = valuesFor({ SANTHA_ENV: 'prod', SANTHA_CLOUD: 'gcp', SANTHA_VALUES_DIR: d }, ENV_KEYS);
    expect(v).toEqual({ LOG_LEVEL: 'info', S3_REGION: 'asia-south1', TRUST_PROXY: '1' });
    const env = parseEnv({ SANTHA_ENV: 'prod', SANTHA_CLOUD: 'gcp', SANTHA_VALUES_DIR: d, LOG_LEVEL: 'debug', ...SECRETS });
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.S3_REGION).toBe('asia-south1');
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('refuses secrets, unknown keys (typos) and nested values', () => {
    const d = dir({ 'test.values.yaml': 'backend:\n  jwtAccessSecret: abc\n  logLevl: info\n  otp:\n    provider: mock\n' });
    expect(() => valuesFor({ SANTHA_ENV: 'test', SANTHA_VALUES_DIR: d }, ENV_KEYS)).toThrow(
      /jwtAccessSecret is a secret[\s\S]*logLevl → LOG_LEVL is not a setting[\s\S]*otp → OTP is not a setting/,
    );
  });

  it('a missing file or overlay is an error, not a silent default', () => {
    const d = dir({ 'test.values.yaml': 'backend: {}\n' });
    expect(() => valuesFor({ SANTHA_ENV: 'prod', SANTHA_VALUES_DIR: d }, ENV_KEYS)).toThrow(/Values file missing: .*prod\.values\.yaml/);
    expect(() => valuesFor({ SANTHA_ENV: 'test', SANTHA_CLOUD: 'aws', SANTHA_VALUES_DIR: d }, ENV_KEYS)).toThrow(/aws\.test\.values\.yaml/);
    expect(() => valuesFor({ SANTHA_ENV: '../etc', SANTHA_VALUES_DIR: d }, ENV_KEYS)).toThrow(/lowercase/);
  });

  describe('the committed files are valid', () => {
    const real = resolve(__dirname, '../../../../config/values');
    it('test: staging app env with test providers', () => {
      const env = parseEnv({ SANTHA_ENV: 'test', SANTHA_VALUES_DIR: real, ...SECRETS, RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' });
      expect(env).toMatchObject({ APP_ENV: 'staging', OTP_PROVIDER: 'mock', PAYMENTS_PROVIDER: 'razorpay_sandbox', TRUST_PROXY: 1, CORS_ORIGINS: 'https://test.santhaapp.com' });
    });
    it('test on a laptop behind a Cloudflare Tunnel: one more proxy hop, everything else as test', () => {
      const env = parseEnv({ SANTHA_ENV: 'test', SANTHA_CLOUD: 'laptop', SANTHA_VALUES_DIR: real, ...SECRETS, PAYMENTS_PROVIDER: 'mock' });
      expect(env).toMatchObject({ APP_ENV: 'staging', PAYMENTS_PROVIDER: 'mock', TRUST_PROXY: 2, CORS_ORIGINS: 'https://test.santhaapp.com' });
    });
    it('prod: live providers; refuses to start until the secrets are set', () => {
      const prodSecrets = {
        ...SECRETS, RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't',
        FCM_SERVICE_ACCOUNT_B64: 'e30=', GOOGLE_MAPS_SERVER_KEY: 'g',
      };
      expect(parseEnv({ SANTHA_ENV: 'prod', SANTHA_VALUES_DIR: real, ...prodSecrets })).toMatchObject({ APP_ENV: 'production', OTP_PROVIDER: 'msg91', PAYMENTS_PROVIDER: 'razorpay' });
      expect(parseEnv({ SANTHA_ENV: 'prod', SANTHA_CLOUD: 'gcp', SANTHA_VALUES_DIR: real, ...prodSecrets }).S3_ENDPOINT).toBe('https://storage.googleapis.com');
      expect(() => parseEnv({ SANTHA_ENV: 'prod', SANTHA_VALUES_DIR: real, ...SECRETS })).toThrow(/MSG91_AUTH_KEY|RAZORPAY_KEY_ID/);
    });
  });
});
