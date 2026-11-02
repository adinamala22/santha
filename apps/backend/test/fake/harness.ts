/**
 * Harness for fake-mode acceptance tests (test/fake/*.fake.spec.ts).
 *
 * Boots the real AppModule with DATA_STORE=memory — no overrides, no Docker — so every guard,
 * pipe, serializer and module wiring is exercised exactly as in `pnpm dev:fake`. Each milestone
 * adds `test/fake/m<N>-<topic>.fake.spec.ts` covering its acceptance checks with this harness.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.factory';
import { AppModule } from '../../src/app.module';
import { SEED_OPS_PASSWORD, SEED_PEOPLE, type SeedPerson } from '../../src/dev/seed-data';

export const FAKE_OTP = '123456';

export type AppId = 'consumer' | 'merchant' | 'rider';

export interface Session {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  user: { id: string; roles: string[]; name: string | null };
  isNewUser: boolean;
  /** Authorization + X-Device-Id headers for authenticated calls. */
  headers: Record<string, string>;
}

export interface FakeApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  /** OTP request → verify with the fixed mock code; returns tokens and ready-made headers. */
  signIn: (phone: string, app: AppId, deviceId?: string) => Promise<Session>;
  /** Ops console sign-in (email + password, then OTP) as the seeded admin unless told otherwise. */
  opsSignIn: (email?: string, password?: string) => Promise<Session>;
  /** First seeded person with the role (see src/dev/seed-data.ts). */
  seeded: (role: string) => SeedPerson;
  close: () => Promise<void>;
}

let deviceSeq = 0;

/**
 * Acceptance scenarios sign the same demo people in many times, so OTP cooldown and rate limits
 * are relaxed by default. Tests about rate limiting pass the real values back via `extraEnv`.
 */
const RELAXED_OTP_LIMITS = {
  OTP_RESEND_COOLDOWN_SEC: '0',
  OTP_LIMIT_PER_PHONE_HOUR: '1000',
  OTP_LIMIT_PER_DEVICE_HOUR: '1000',
  OTP_LIMIT_PER_IP_HOUR: '10000',
};

export async function bootFakeApp(extraEnv: Record<string, string> = {}): Promise<FakeApp> {
  const saved = { ...process.env };
  Object.assign(
    process.env,
    { DATA_STORE: 'memory', MOCK_OTP_CODE: FAKE_OTP, OTP_PROVIDER: 'mock' },
    RELAXED_OTP_LIMITS,
    extraEnv,
  );
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const http = () => request(app.getHttpServer());

  const signIn = async (phone: string, appId: AppId, deviceId = `fake-device-${++deviceSeq}`): Promise<Session> => {
    const local = phone.replace(/^\+91/, '');
    const req = await http().post('/v1/auth/otp/request').send({ phone: local, deviceId, app: appId }).expect(200);
    const res = await http()
      .post('/v1/auth/otp/verify')
      .send({ challengeId: req.body.challengeId, code: FAKE_OTP, deviceId, app: appId, platform: 'android' })
      .expect(200);
    return {
      ...res.body,
      deviceId,
      headers: { Authorization: `Bearer ${res.body.accessToken}`, 'X-Device-Id': deviceId },
    };
  };

  const opsSignIn = async (email = 'admin@santha.local', password = SEED_OPS_PASSWORD): Promise<Session> => {
    const deviceId = `ops-console-${++deviceSeq}`;
    const login = await http().post('/v1/auth/ops/login').send({ email, password, deviceId }).expect(200);
    const res = await http()
      .post('/v1/auth/ops/verify')
      .send({ challengeId: login.body.challengeId, code: FAKE_OTP, deviceId })
      .expect(200);
    return {
      ...res.body,
      deviceId,
      headers: { Authorization: `Bearer ${res.body.accessToken}`, 'X-Device-Id': deviceId },
    };
  };

  const seeded = (role: string): SeedPerson => {
    const p = SEED_PEOPLE.find((x) => x.roles.includes(role as SeedPerson['roles'][number]));
    if (!p) throw new Error(`No seeded person with role ${role}`);
    return p;
  };

  return {
    app,
    http,
    signIn,
    opsSignIn,
    seeded,
    close: async () => {
      await app.close();
      process.env = saved;
    },
  };
}
