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

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

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
    MSG91_TEMPLATE_ID: z.string().optional(),

    RUN_WORKERS: bool.default(true),
    OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production') {
      if (env.OTP_PROVIDER === 'mock')
        ctx.addIssue({ code: 'custom', path: ['OTP_PROVIDER'], message: 'mock OTP is not allowed in production' });
      for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const)
        if (env[k].length < 32 || env[k].startsWith('change-me'))
          ctx.addIssue({ code: 'custom', path: [k], message: 'must be a strong secret (≥32 chars) in production' });
    }
    if (env.OTP_PROVIDER === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID))
      ctx.addIssue({ code: 'custom', path: ['MSG91_AUTH_KEY'], message: 'MSG91_AUTH_KEY and MSG91_TEMPLATE_ID required' });
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
