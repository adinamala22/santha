// Defaults for tests; integration tests override DATABASE_URL / REDIS_URL with container URLs.
process.env.NODE_ENV = 'test';
process.env.APP_ENV ??= 'dev';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.RUN_WORKERS ??= 'false';
process.env.LOG_LEVEL ??= 'fatal';
process.env.OTP_PROVIDER = 'mock';
delete process.env.MOCK_OTP_CODE;

// Keep test output readable; tests assert on behaviour, not logs.
import { Logger } from '@nestjs/common';
Logger.overrideLogger(false);
