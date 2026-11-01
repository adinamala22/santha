/**
 * Local fake mode: `pnpm dev:fake` (root) or `pnpm --filter backend dev:fake`.
 * Runs the real API with in-memory stores preloaded with the demo seed — no Docker, Postgres or
 * Redis. Sign in with any seeded number (README "Signing in locally") and code 123456.
 * Data resets on every restart. Never used outside local dev (env validation refuses it).
 */
process.env.DATA_STORE = 'memory';
process.env.APP_ENV ??= 'dev';
process.env.OTP_PROVIDER = 'mock'; // never call a real SMS provider from fake mode
process.env.MOCK_OTP_CODE ??= '123456';
// Dev-only defaults so fake mode works without a .env file.
process.env.JWT_ACCESS_SECRET ??= 'fake-mode-dev-only-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'fake-mode-dev-only-refresh-secret';

void import('../main');
