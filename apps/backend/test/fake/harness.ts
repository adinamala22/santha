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
import sharp from 'sharp';
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
  /**
   * Media pipeline round trip as the app does it: ask for an upload, PUT the bytes to the
   * presigned URL (in-memory storage in fake mode), complete. Returns the processed media.
   */
  uploadPhoto: (s: Session, purpose: 'item' | 'store', image?: Buffer) => Promise<{ id: string; status: string; thumbUrl: string; mediumUrl: string }>;
  /** Rider photo round trip (ADR-030): selfie / licence card, or a door photo for a delivery on the way. */
  uploadRiderPhoto: (s: Session, kind: 'selfie' | 'licence' | 'delivery', fulfilmentId?: string) => Promise<{ id: string; kind: string; status: string }>;
  /** Moves the fake-mode dev clock forward. */
  advanceClock: (hours: number) => Promise<Date>;
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
  OPS_LOGIN_LIMIT_PER_EMAIL_HOUR: '1000',
  OPS_LOGIN_LIMIT_PER_IP_HOUR: '1000',
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
  const app = mod.createNestApplication({ logger: false, rawBody: true });
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

  const uploadPhoto: FakeApp['uploadPhoto'] = async (s, purpose, image) => {
    const body = image ?? (await testImage());
    const t = await http().post('/v1/merchants/me/media').set(s.headers).send({ purpose, contentType: 'image/png' }).expect(201);
    await http().put(t.body.upload.url).set('Content-Type', 'image/png').send(body).expect(200);
    return (await http().post(`/v1/merchants/me/media/${t.body.media.id}/complete`).set(s.headers).expect(200)).body;
  };

  const uploadRiderPhoto: FakeApp['uploadRiderPhoto'] = async (s, kind, fulfilmentId) => {
    const t = await http().post('/v1/riders/me/photos').set(s.headers).send({ kind, contentType: 'image/png', ...(fulfilmentId ? { fulfilmentId } : {}) }).expect(201);
    await http().put(t.body.upload.url).set('Content-Type', 'image/png').send(await testImage()).expect(200);
    return (await http().post(`/v1/riders/me/photos/${t.body.photo.id}/complete`).set(s.headers).expect(200)).body;
  };

  const advanceClock = async (hours: number): Promise<Date> => {
    const r = await http().post('/v1/dev/clock').send({ hours }).expect(200);
    return new Date(r.body.now);
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
    uploadPhoto,
    uploadRiderPhoto,
    advanceClock,
    seeded,
    close: async () => {
      await app.close();
      process.env = saved;
    },
  };
}

/** A 640×480 PNG test photo (gradient + noise so WebP sizes are realistic). */
export async function testImage(width = 640, height = 480): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = ((x * y) % 97) * 2;
    }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
