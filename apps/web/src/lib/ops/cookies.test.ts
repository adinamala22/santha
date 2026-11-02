import { describe, expect, it } from 'vitest';
import { fakeJwt } from '@/test/jwt';
import { isExpired, readClaims } from './cookies';


describe('ops session cookies', () => {
  it('reads sub, roles and exp from the access token', () => {
    expect(readClaims(fakeJwt({ sub: 'u1', roles: ['admin', 'ops'], exp: 2_000_000_000 }))).toEqual({ sub: 'u1', roles: ['admin', 'ops'], exp: 2_000_000_000 });
    expect(readClaims('not-a-jwt')).toBeNull();
    expect(readClaims(undefined)).toBeNull();
  });

  it('treats tokens expiring within 30 s as expired', () => {
    const now = 1_000_000;
    expect(isExpired(fakeJwt({ sub: 'u', exp: now + 600 }), now)).toBe(false);
    expect(isExpired(fakeJwt({ sub: 'u', exp: now + 10 }), now)).toBe(true);
    expect(isExpired(undefined, now)).toBe(true);
  });
});
