import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Every environment variable the backend reads. Parsed once at boot; the process refuses to
 * start on invalid config. Documented for humans in the root `.env.example`.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['dev', 'staging', 'production']).default('dev'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    /**
     * `postgres` (default): Postgres + PostGIS and Redis from docker-compose.
     * `memory`: local fake mode — in-memory stores loaded with the demo seed, no Docker needed,
     * data lost on restart. Dev only; refused for staging/production.
     */
    DATA_STORE: z.enum(['postgres', 'memory']).default('postgres'),
    DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url().optional(),

    JWT_ACCESS_SECRET: z.string().min(8),
    JWT_REFRESH_SECRET: z.string().min(8),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(15 * 60),
    JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(30 * 24 * 3600),

    OTP_PROVIDER: z.enum(['mock', 'msg91']).default('mock'),
    /** Fixed code for the mock provider so device testing is easy. Ignored unless OTP_PROVIDER=mock. */
    MOCK_OTP_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(30),
    OTP_LIMIT_PER_PHONE_HOUR: z.coerce.number().int().positive().default(5),
    OTP_LIMIT_PER_DEVICE_HOUR: z.coerce.number().int().positive().default(10),
    OTP_LIMIT_PER_IP_HOUR: z.coerce.number().int().positive().default(30),
    MSG91_AUTH_KEY: z.string().optional(),
    /** KYC/verification provider (PAN, Aadhaar, GSTIN, FSSAI, penny-drop). */
    KYC_PROVIDER: z.enum(['mock', 'digio']).default('mock'),
    MSG91_TEMPLATE_ID: z.string().optional(),

    /** PostHog (self-hosted, India region) project key for feature flags; unset = code defaults + FLAG_OVERRIDES. */
    POSTHOG_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().url().optional(),
    /** Local flag overrides, JSON object of flag → boolean, e.g. {"cod_payments":false}. */
    FLAG_OVERRIDES: z
      .string()
      .optional()
      .transform((s, ctx) => {
        if (!s) return {} as Record<string, boolean>;
        try {
          const v = JSON.parse(s) as unknown;
          if (v && typeof v === 'object' && Object.values(v).every((x) => typeof x === 'boolean'))
            return v as Record<string, boolean>;
        } catch {
          /* fall through */
        }
        ctx.addIssue({ code: 'custom', message: 'must be a JSON object of booleans' });
        return z.NEVER;
      }),

    /** Ops refresh sessions are short (santha-web skill: 8 h). */
    OPS_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(8 * 3600),
    /** Ops console password attempts (step 1 of sign-in) per email and per IP per hour. */
    OPS_LOGIN_LIMIT_PER_EMAIL_HOUR: z.coerce.number().int().positive().default(10),
    OPS_LOGIN_LIMIT_PER_IP_HOUR: z.coerce.number().int().positive().default(30),

    /** Search engine. Fake mode always uses the in-memory index; Postgres mode defaults to Typesense. */
    SEARCH_ENGINE: z.enum(['typesense', 'memory']).optional(),
    TYPESENSE_HOST: z.string().default('localhost'),
    TYPESENSE_PORT: z.coerce.number().int().positive().default(8108),
    TYPESENSE_PROTOCOL: z.enum(['http', 'https']).default('http'),
    TYPESENSE_API_KEY: z.string().optional(),
    /** Collection name prefix, so tests and environments can share one Typesense. */
    TYPESENSE_PREFIX: z.string().regex(/^[a-z0-9_]*$/).default(''),

    /** Object storage (S3 in AWS, RustFS locally). Fake mode keeps uploads in memory. */
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    /** Public base URL for stored images (CloudFront in AWS; the bucket URL locally). */
    CDN_BASE_URL: z.string().url().optional(),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),

    /** Routing for ETA travel times. mock = straight line × road factor at town speed (dev/test). */
    MAPS_PROVIDER: z.enum(['mock', 'google']).default('mock'),
    GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
    /** Fallback lookup for barcodes missing from the master catalogue (FR-CAT-1). */
    BARCODE_PROVIDER: z.enum(['mock', 'openfoodfacts']).default('mock'),
    /** How often the catalogue staleness sweep runs (minutes). */
    STALENESS_SWEEP_MIN: z.coerce.number().int().positive().default(60),

    RUN_WORKERS: bool.default(true),
    OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production') {
      if (env.OTP_PROVIDER === 'mock')
        ctx.addIssue({ code: 'custom', path: ['OTP_PROVIDER'], message: 'mock OTP is not allowed in production' });
      if (env.KYC_PROVIDER === 'mock')
        ctx.addIssue({ code: 'custom', path: ['KYC_PROVIDER'], message: 'mock KYC is not allowed in production' });
      for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const)
        if (env[k].length < 32 || env[k].startsWith('change-me'))
          ctx.addIssue({ code: 'custom', path: [k], message: 'must be a strong secret (≥32 chars) in production' });
    }
    if (env.MAPS_PROVIDER === 'google' && !env.GOOGLE_MAPS_SERVER_KEY)
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_MAPS_SERVER_KEY'], message: 'required when MAPS_PROVIDER=google' });
    if (env.OTP_PROVIDER === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID))
      ctx.addIssue({ code: 'custom', path: ['MSG91_AUTH_KEY'], message: 'MSG91_AUTH_KEY and MSG91_TEMPLATE_ID required' });
    if (env.DATA_STORE === 'memory') {
      if (env.APP_ENV !== 'dev')
        ctx.addIssue({ code: 'custom', path: ['DATA_STORE'], message: 'memory store is for local dev only (APP_ENV=dev)' });
    } else {
      for (const k of ['DATABASE_URL', 'REDIS_URL'] as const)
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `required when DATA_STORE=postgres` });
    }
  })
  // Downstream code always gets strings; in memory mode they are empty and never used.
  .transform((env) => ({
    ...env,
    DATABASE_URL: env.DATABASE_URL ?? '',
    REDIS_URL: env.REDIS_URL ?? '',
    // Fake mode is all in-memory, whatever the .env says.
    SEARCH_ENGINE: env.DATA_STORE === 'memory' ? ('memory' as const) : (env.SEARCH_ENGINE ?? ('typesense' as const)),
  }));

export type Env = z.infer<typeof EnvSchema>;

/** Background workers (outbox relay, queue consumers) need Postgres + Redis; off in memory mode. */
export const workersEnabled = (env: Env): boolean => env.RUN_WORKERS && env.DATA_STORE === 'postgres';

export function parseEnv(source: Record<string, string | undefined>): Env {
  // `KEY=` in a .env file means "not set" (the .env.example lists optional keys with empty values).
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
