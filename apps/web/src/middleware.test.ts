// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeJwt } from './test/jwt';
import { middleware } from './middleware';

const req = (path: string, cookies: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
  });

const valid = fakeJwt({ sub: 'u1', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 900 });
const expired = fakeJwt({ sub: 'u1', roles: ['admin'], exp: Math.floor(Date.now() / 1000) - 5 });

afterEach(() => vi.unstubAllGlobals());

describe('admin middleware', () => {
  it('lets the login page through', async () => {
    const res = await middleware(req('/admin/login'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('sends signed-out users to login, remembering where they were going', async () => {
    const res = await middleware(req('/admin/merchants?status=submitted'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/admin/login?next=%2Fadmin%2Fmerchants%3Fstatus%3Dsubmitted');
  });

  it('passes a valid session straight through', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await middleware(req('/admin', { santha_ops_at: valid, santha_ops_did: 'web-1' }));
    expect(res.headers.get('location')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expired access token and stores the rotated tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: valid, refreshToken: 'sess.new', accessExpiresIn: 900, refreshExpiresIn: 28800 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await middleware(req('/admin', { santha_ops_at: expired, santha_ops_rt: 'sess.old', santha_ops_did: 'web-1' }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/auth\/refresh$/),
      expect.objectContaining({ body: JSON.stringify({ refreshToken: 'sess.old', deviceId: 'web-1' }) }),
    );
    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get('santha_ops_rt')?.value).toBe('sess.new');
    expect(res.cookies.get('santha_ops_at')?.httpOnly).toBe(true);
  });

  it('a rejected refresh signs the user out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const res = await middleware(req('/admin', { santha_ops_at: expired, santha_ops_rt: 'sess.old', santha_ops_did: 'web-1' }));
    expect(res.headers.get('location')).toBe('http://localhost:3000/admin/login');
  });
});
