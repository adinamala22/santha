import type { NextConfig } from 'next';

const origin = (url: string | undefined, fallback: string) => {
  try {
    return new URL(url ?? fallback).origin;
  } catch {
    return fallback;
  }
};
const api = origin(process.env.NEXT_PUBLIC_API_URL, 'http://localhost:4000');
const tiles = origin(process.env.NEXT_PUBLIC_MAP_TILES_URL?.replace(/\{[a-z]\}/g, 'a'), 'https://tile.openstreetmap.org');
const dev = process.env.NODE_ENV !== 'production';

// The App Router inlines its bootstrap scripts, so script-src needs 'unsafe-inline' unless nonces are added.
// Maps (Leaflet) set inline styles. Images come from the API's media URLs and the map tile server.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${api} ${tiles} https://*.tile.openstreetmap.org`,
  "font-src 'self' data:",
  `connect-src 'self' ${api} ${api.replace(/^http/, 'ws')}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
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
  transpilePackages: ['@santha/shared-types'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
