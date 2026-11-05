import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentSecurityPolicy } from './csp';
import { configScript, publicConfig, serverConfig } from './runtime-config';

/** ADR-025: one website image for QA and PROD; addresses come from the environment at run time. */
describe('runtime config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__SANTHA__;
  });

  it('reads the runtime names first, the old NEXT_PUBLIC_* names as a fallback, then local defaults', () => {
    vi.stubEnv('SITE_URL', 'https://santhaapp.com');
    vi.stubEnv('PUBLIC_API_URL', 'https://api.santhaapp.com');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://ignored.example');
    vi.stubEnv('MEDIA_ORIGIN', '');
    expect(serverConfig()).toMatchObject({ siteUrl: 'https://santhaapp.com', apiUrl: 'https://api.santhaapp.com', mediaOrigin: '' });
    vi.unstubAllEnvs();
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('PUBLIC_API_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4100');
    expect(serverConfig().apiUrl).toBe('http://localhost:4100');
  });

  it('the browser uses what the root layout injected', () => {
    window.__SANTHA__ = { siteUrl: 'https://test.santhaapp.com', apiUrl: 'https://api.test.santhaapp.com', mediaOrigin: '', tilesUrl: 't' };
    expect(publicConfig().apiUrl).toBe('https://api.test.santhaapp.com');
  });

  it('the injected script cannot close its own tag', () => {
    vi.stubEnv('SITE_URL', 'https://x.example/</script><script>alert(1)</script>');
    expect(configScript()).not.toContain('</script>');
    expect(configScript()).toMatch(/^window\.__SANTHA__=\{/);
  });

  it('the CSP allows exactly this environment’s API, media and tiles', () => {
    const csp = contentSecurityPolicy({ siteUrl: 'https://santhaapp.com', apiUrl: 'https://api.santhaapp.com/', mediaOrigin: 'https://cdn.example/bucket', tilesUrl: 'https://{s}.tiles.example/{z}/{x}/{y}.png' });
    expect(csp).toContain("connect-src 'self' https://api.santhaapp.com wss://api.santhaapp.com https://a.tiles.example");
    expect(csp).toContain('img-src');
    expect(csp).toContain('https://cdn.example');
    expect(csp).not.toContain('test.santhaapp.com');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy({ siteUrl: '', apiUrl: '', mediaOrigin: '', tilesUrl: '' })).toContain('http://localhost:4000');
  });
});
