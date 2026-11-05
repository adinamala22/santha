/**
 * Launch landing page (ADR-023, fake mode):
 * - GET /v1/config/site is public; downloads are off by default (app_downloads flag), so the site says
 *   "Launching soon" and no store links are given; FLAG_OVERRIDES (or PostHog) turns them on;
 * - store leads carry the shop name and type; "customer" leads are launch-list sign-ups; ops see both.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootFakeApp, type FakeApp } from './harness';

describe('Launch landing page (fake mode)', () => {
  let fake: FakeApp;
  const http = () => fake.http();

  beforeAll(async () => {
    fake = await bootFakeApp();
  }, 60_000);
  afterAll(() => fake?.close());

  it('ACCEPTANCE: site config is public and says downloads are off until launch', async () => {
    const r = (await http().get('/v1/config/site').expect(200)).body;
    expect(r).toEqual({ appDownloads: false, androidUrl: null, iosUrl: null });
  });

  it('with app_downloads on, the store links are given', async () => {
    const on = await bootFakeApp({
      FLAG_OVERRIDES: JSON.stringify({ app_downloads: true }),
      ANDROID_APP_URL: 'https://play.google.com/store/apps/details?id=app.santha.consumer',
      IOS_APP_URL: 'https://apps.apple.com/in/app/santha/id0000000000',
    });
    try {
      const r = (await on.http().get('/v1/config/site').expect(200)).body;
      expect(r).toEqual({
        appDownloads: true,
        androidUrl: 'https://play.google.com/store/apps/details?id=app.santha.consumer',
        iosUrl: 'https://apps.apple.com/in/app/santha/id0000000000',
      });
    } finally {
      await on.close();
    }
  }, 60_000);

  it('store leads carry the shop name and type; launch-list sign-ups are customer leads; ops see both', async () => {
    await http().post('/v1/leads').send({ kind: 'store', name: 'Ravi Kumar', phone: '9876502001', business: 'Sri Sai Kirana', category: 'kirana', area: 'Dargamitta' }).expect(201);
    await http().post('/v1/leads').send({ kind: 'store', name: 'Ravi Kumar', phone: '9876502002', category: 'not-a-type' }).expect(400);
    await http().post('/v1/leads').send({ kind: 'customer', name: 'Lakshmi', phone: '9876502003', locale: 'te' }).expect(201);
    const ops = (await fake.opsSignIn()).headers;
    const leads = (await http().get('/v1/ops/leads').set(ops).expect(200)).body.items as Array<Record<string, unknown>>;
    expect(leads.find((l) => l.phone === '+919876502001')).toMatchObject({ kind: 'store', business: 'Sri Sai Kirana', category: 'kirana', area: 'Dargamitta' });
    expect(leads.find((l) => l.phone === '+919876502003')).toMatchObject({ kind: 'customer', name: 'Lakshmi', locale: 'te', business: null });
  });
});
