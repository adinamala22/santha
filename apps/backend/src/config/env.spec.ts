import { describe, expect, it } from 'vitest';
import { parseEnv, workersEnabled } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'change-me-dev',
  JWT_REFRESH_SECRET: 'change-me-dev',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({ PORT: 4000, APP_ENV: 'dev', OTP_PROVIDER: 'mock', JWT_ACCESS_TTL_SEC: 900, RUN_WORKERS: true });
    expect(env.JWT_REFRESH_TTL_SEC).toBe(30 * 24 * 3600);
  });

  it('fails with a readable message on missing values', () => {
    expect(() => parseEnv({})).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL: required when DATA_STORE=postgres/);
  });

  it('memory store needs no database or redis, and only in dev', () => {
    const noInfra = { ...base, DATABASE_URL: undefined, REDIS_URL: undefined };
    const env = parseEnv({ ...noInfra, DATA_STORE: 'memory' });
    expect(env).toMatchObject({ DATA_STORE: 'memory', DATABASE_URL: '', REDIS_URL: '' });
    expect(() => parseEnv({ ...base, DATA_STORE: 'memory', APP_ENV: 'staging' })).toThrow(/memory store is for local dev only/);
  });

  it('forbids mock OTP and weak secrets in production', () => {
    expect(() => parseEnv({ ...base, APP_ENV: 'production' })).toThrow(/mock OTP is not allowed[\s\S]*JWT_ACCESS_SECRET/);
  });

  it('ADR-024: pre-launch production runs without live payments, KYC or SMS, and only then on password-only ops login', () => {
    const strong = { ...base, APP_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40) };
    const prelaunch = { ...strong, LAUNCH_STAGE: 'prelaunch', OPS_LOGIN_OTP: 'off' };
    expect(parseEnv(prelaunch)).toMatchObject({ LAUNCH_STAGE: 'prelaunch', OPS_LOGIN_OTP: 'off', PAYMENTS_PROVIDER: 'mock', KYC_PROVIDER: 'mock' });
    // The mock (fixed) OTP never guards the prod console: with the second factor on, a real provider is required.
    expect(() => parseEnv({ ...prelaunch, OPS_LOGIN_OTP: 'required' })).toThrow(/mock OTP is not allowed/);
    // Going live re-enables every check, and the console needs its OTP again.
    for (const why of [/OPS_LOGIN_OTP/, /mock OTP is not allowed/, /mock KYC is not allowed/, /live payments only/])
      expect(() => parseEnv({ ...prelaunch, LAUNCH_STAGE: 'live' })).toThrow(why);
    expect(parseEnv(base)).toMatchObject({ LAUNCH_STAGE: 'live', OPS_LOGIN_OTP: 'required' });
  });

  it('requires MSG91 credentials when the provider is msg91', () => {
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY/);
  });

  it('treats empty values from .env as unset', () => {
    const env = parseEnv({ ...base, POSTHOG_HOST: '', POSTHOG_KEY: '', FLAG_OVERRIDES: '', MOCK_OTP_CODE: '' });
    expect(env.POSTHOG_HOST).toBeUndefined();
    expect(env.FLAG_OVERRIDES).toEqual({});
    expect(env.MOCK_OTP_CODE).toBeUndefined();
  });

  it('parses boolean flags', () => {
    expect(parseEnv({ ...base, RUN_WORKERS: 'false' }).RUN_WORKERS).toBe(false);
  });

  it('never runs workers in memory mode', () => {
    expect(workersEnabled(parseEnv(base))).toBe(true);
    expect(workersEnabled(parseEnv({ ...base, DATA_STORE: 'memory' }))).toBe(false);
  });
});
