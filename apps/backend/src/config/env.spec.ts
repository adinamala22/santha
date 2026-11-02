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
