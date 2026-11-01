import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

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
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('forbids mock OTP and weak secrets in production', () => {
    expect(() => parseEnv({ ...base, APP_ENV: 'production' })).toThrow(/mock OTP is not allowed[\s\S]*JWT_ACCESS_SECRET/);
  });

  it('requires MSG91 credentials when the provider is msg91', () => {
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY/);
  });

  it('parses boolean flags', () => {
    expect(parseEnv({ ...base, RUN_WORKERS: 'false' }).RUN_WORKERS).toBe(false);
  });
});
