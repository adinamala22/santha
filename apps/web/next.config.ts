import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

// The Content-Security-Policy depends on runtime settings (API and media origins: one image for QA and PROD,
// ADR-025), so the middleware sends it (src/lib/csp.ts). The rest do not.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Container builds set NEXT_STANDALONE=1 (standalone needs symlink rights, which Windows dev boxes often lack).
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  // pnpm monorepo: trace server dependencies from the repo root so the standalone bundle is complete.
  outputFileTracingRoot: resolve(__dirname, '../..'),
  transpilePackages: ['@santha/shared-types'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
