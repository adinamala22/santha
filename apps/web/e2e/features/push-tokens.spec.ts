import { expect, test } from '@playwright/test';
import { API, appSignIn, freshPhone } from '../support/target';

/**
 * Push registration (ADR-027), fake + live, API only: the apps register this phone's FCM token after sign-in
 * and remove it before signing out. Uses a new customer and a made-up token, so nothing is sent anywhere.
 */
test('a phone registers its push token and removes it at sign-out; tokens are validated and need a session', async ({ request }) => {
  const headers = await appSignIn(request, freshPhone(), 'consumer');
  const token = `e2e-fcm-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const put = await request.put(`${API}/me/push-token`, { headers, data: { token, platform: 'android' } });
  expect(put.status(), await put.text()).toBe(204);
  const again = await request.put(`${API}/me/push-token`, { headers, data: { token, platform: 'android' } }); // idempotent
  expect(again.status()).toBe(204);

  expect((await request.put(`${API}/me/push-token`, { headers, data: { token: 'short', platform: 'android' } })).status()).toBe(400);
  expect((await request.put(`${API}/me/push-token`, { data: { token, platform: 'android' } })).status()).toBe(401);

  const del = await request.delete(`${API}/me/push-token`, { headers });
  expect(del.status(), await del.text()).toBe(204);
  expect((await request.delete(`${API}/me/push-token`, { headers })).status()).toBe(204); // nothing left: still fine
});
