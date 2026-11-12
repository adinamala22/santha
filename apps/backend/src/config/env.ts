import { z } from 'zod';
import { valuesFor } from './values';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Every environment variable the backend reads. Parsed once at boot; the process refuses to
 * start on invalid config. Documented for humans in the root `.env.example`.
 */
const EnvObject = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['dev', 'staging', 'production']).default('dev'),
    /**
     * prelaunch: only the website and the ops console are served; the apps' endpoints answer 503 PRELAUNCH, so
     * production can run before live payment / KYC / SMS accounts exist (ADR-024). live: everything.
     */
    LAUNCH_STAGE: z.enum(['prelaunch', 'live']).default('live'),
    /** Ops console second factor. off (password only) is allowed only before launch (ADR-024). */
    OPS_LOGIN_OTP: z.enum(['required', 'off']).default('required'),
    /**
     * Phones Santha pages (an SMS and an automated call each) when a rider presses SOS, comma-separated with the
     * country code, e.g. +919876543210 (ADR-034). Empty: nobody is paged and ops rely on the console alone.
     */
    OPS_ALERT_PHONES: z
      .string()
      .default('')
      .refine((v) => v.split(',').map((x) => x.trim()).filter(Boolean).every((x) => /^\+\d{10,15}$/.test(x)), 'comma-separated phone numbers like +919876543210'),
    /** Language of the on-call SOS page. */
    OPS_ALERT_LOCALE: z.enum(['en', 'te']).default('en'),
    /** Page again when an SOS is still open after this many seconds (0 = never). */
    OPS_SOS_REPAGE_SEC: z.coerce.number().int().min(0).max(3600).default(180),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    /**
     * Reverse proxies in front of the API, counted from the server (0 = none). Behind Caddy it is 1. Without it
     * every request looks like it comes from the proxy, so the per-IP OTP and login limits would block all users.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

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

    /** none = no SMS: login codes go on WhatsApp only (ADR-041). */
    OTP_PROVIDER: z.enum(['mock', 'msg91', 'none']).default('mock'),
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
    KYC_PROVIDER: z.enum(['mock', 'digio', 'manual']).default('mock'),
    MSG91_TEMPLATE_ID: z.string().optional(),

    /**
     * WhatsApp login OTPs (Meta WhatsApp Cloud API, authentication template). Used only while the feature flag
     * `whatsapp_otp` is on; SMS stays the fallback. `mock` records messages (dev/test/fake mode); `cloud` calls Meta.
     */
    WHATSAPP_PROVIDER: z.enum(['mock', 'cloud']).default('mock'),
    /** Permanent System User token with whatsapp_business_messaging (secret). */
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    /** Phone number ID of the sending number (WhatsApp Manager → API setup); not the phone number itself. */
    WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).optional(),
    /** Approved authentication template with a copy-code button, in English and Telugu. */
    WHATSAPP_OTP_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).default('santha_login_otp'),
    WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
    WHATSAPP_GRAPH_URL: z.string().url().default('https://graph.facebook.com'),
    WHATSAPP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

    /** PostHog (self-hosted, India region) project key for feature flags; unset = code defaults + FLAG_OVERRIDES. */
    POSTHOG_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().url().optional(),
    /** Store listings for the website download buttons (shown only with the app_downloads flag, ADR-023). */
    ANDROID_APP_URL: z.string().url().optional(),
    IOS_APP_URL: z.string().url().optional(),
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

    /** Payments (M4). razorpay_sandbox = Razorpay test-mode keys; mock = in-process, dev/test only (fake mode always mock). */
    PAYMENTS_PROVIDER: z.enum(['mock', 'razorpay_sandbox', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    /** Minutes an online order waits for payment before it becomes PAYMENT_FAILED. */
    PAYMENT_WINDOW_MIN: z.coerce.number().int().min(5).max(60).default(15),
    /** Minutes a checkout quote stays valid. */
    QUOTE_TTL_MIN: z.coerce.number().int().min(5).max(120).default(30),

    /** Push notifications (M5): mock (dev/test, records) | fcm (needs FCM_SERVICE_ACCOUNT_B64 = base64 service-account JSON). */
    PUSH_PROVIDER: z.enum(['mock', 'fcm']).default('mock'),
    FCM_SERVICE_ACCOUNT_B64: z.string().optional(),

    /** Dispatch (M6): 3PL fallback partner (mock only until a Nellore partner is contracted); whether the mock has capacity. */
    THREEPL_PROVIDER: z.enum(['mock']).default('mock'),
    MOCK_3PL_AVAILABLE: bool.default(false),
    /** Public base URL of the web app, for staff delivery links (/d/{token}). */
    WEB_BASE_URL: z.string().url().default('http://localhost:3000'),

    RUN_WORKERS: bool.default(true),
    OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
});

/** Names of every variable the backend reads (values files may only set these). */
export const ENV_KEYS: ReadonlySet<string> = new Set(Object.keys(EnvObject.shape));

export const EnvSchema = EnvObject
  .superRefine((env, ctx) => {
    if (env.OPS_LOGIN_OTP === 'off' && env.APP_ENV === 'production' && env.LAUNCH_STAGE !== 'prelaunch')
      ctx.addIssue({ code: 'custom', path: ['OPS_LOGIN_OTP'], message: 'the ops console needs its OTP once live (OPS_LOGIN_OTP=off is for pre-launch only)' });
    // Pre-launch production serves no app endpoints, so payments, KYC and app OTPs are not reachable yet (ADR-024).
    // The ops console still may not use the fixed mock code: mock OTP only with OPS_LOGIN_OTP=off.
    const prelaunch = env.LAUNCH_STAGE === 'prelaunch';
    if (env.APP_ENV === 'production') {
      if (env.OTP_PROVIDER === 'mock' && !(prelaunch && env.OPS_LOGIN_OTP === 'off'))
        ctx.addIssue({ code: 'custom', path: ['OTP_PROVIDER'], message: 'mock OTP is not allowed in production' });
      if (env.KYC_PROVIDER === 'mock' && !prelaunch)
        ctx.addIssue({ code: 'custom', path: ['KYC_PROVIDER'], message: 'mock KYC is not allowed in production' });
      if (env.PAYMENTS_PROVIDER !== 'razorpay' && !prelaunch)
        ctx.addIssue({ code: 'custom', path: ['PAYMENTS_PROVIDER'], message: 'production takes live payments only (razorpay)' });
      for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const)
        if (env[k].length < 32 || env[k].startsWith('change-me'))
          ctx.addIssue({ code: 'custom', path: [k], message: 'must be a strong secret (≥32 chars) in production' });
    }
    if (env.PAYMENTS_PROVIDER !== 'mock')
      for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const)
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `required when PAYMENTS_PROVIDER=${env.PAYMENTS_PROVIDER}` });
    if (env.PUSH_PROVIDER === 'fcm' && !env.FCM_SERVICE_ACCOUNT_B64)
      ctx.addIssue({ code: 'custom', path: ['FCM_SERVICE_ACCOUNT_B64'], message: 'required when PUSH_PROVIDER=fcm' });
    if (env.MAPS_PROVIDER === 'google' && !env.GOOGLE_MAPS_SERVER_KEY)
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_MAPS_SERVER_KEY'], message: 'required when MAPS_PROVIDER=google' });
    if (env.WHATSAPP_PROVIDER === 'cloud')
      for (const k of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] as const)
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when WHATSAPP_PROVIDER=cloud' });
    if (env.OTP_PROVIDER === 'none' && env.WHATSAPP_PROVIDER !== 'cloud')
      ctx.addIssue({ code: 'custom', path: ['WHATSAPP_PROVIDER'], message: 'OTP_PROVIDER=none sends codes on WhatsApp only, so WHATSAPP_PROVIDER must be cloud' });
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
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  // With SANTHA_ENV=test|prod, non-secret settings come from config/values/<env>.values.yaml (and the
  // <SANTHA_CLOUD>.<env> overlay). Real environment variables still win; secrets only ever come from them.
  const cleaned = { ...valuesFor(set, ENV_KEYS), ...set };
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
