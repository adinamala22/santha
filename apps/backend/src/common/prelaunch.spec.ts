import { describe, expect, it } from 'vitest';
import { prelaunchAllows } from './prelaunch';

describe('pre-launch allow-list (ADR-024)', () => {
  it('serves the website and the ops console', () => {
    for (const [m, p] of [
      ['GET', '/v1/health/ready'],
      ['GET', '/v1/config/site'],
      ['POST', '/v1/leads'],
      ['GET', '/v1/public/stores'],
      ['GET', '/v1/stores/10000000-0000-4000-8000-000000000201?lat=1&lng=2'],
      ['POST', '/v1/auth/ops/login'],
      ['POST', '/v1/auth/refresh'],
      ['GET', '/v1/me'],
      ['GET', '/v1/ops/leads'],
      ['PATCH', '/v1/ops/leads/abc'],
    ])
      expect(prelaunchAllows(m!, p!), `${m} ${p}`).toBe(true);
  });
  it('closes everything the apps use', () => {
    for (const [m, p] of [
      ['POST', '/v1/auth/otp/request'],
      ['POST', '/v1/orders'],
      ['PUT', '/v1/cart'],
      ['GET', '/v1/feed'],
      ['GET', '/v1/me/addresses'],
      ['GET', '/v1/merchants/me'],
      ['PUT', '/v1/riders/me/status'],
      ['POST', '/v1/payments/webhook'],
      ['GET', '/socket.io/?EIO=4'],
      ['POST', '/v1/leads/extra'],
      ['GET', '/v1/config/flags'],
    ])
      expect(prelaunchAllows(m!, p!), `${m} ${p}`).toBe(false);
  });
});
