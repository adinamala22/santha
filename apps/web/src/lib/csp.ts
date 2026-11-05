import type { PublicConfig } from './runtime-config';

const origin = (url: string | undefined, fallback: string) => {
  try {
    return new URL(url || fallback).origin;
  } catch {
    return fallback;
  }
};

/**
 * Content-Security-Policy for every page, from the runtime settings (ADR-025: one image for QA and PROD, so the API,
 * media and tile origins are not known at build time). Sent by the middleware.
 * The App Router inlines its bootstrap scripts, so script-src needs 'unsafe-inline' unless nonces are added.
 * Maps (Leaflet/MapLibre) set inline styles. Images come from the API's media URLs and the map tile server.
 */
export function contentSecurityPolicy(c: PublicConfig, dev = false): string {
  const api = origin(c.apiUrl, 'http://localhost:4000');
  const tiles = origin(c.tilesUrl.replace(/\{[a-z]\}/g, 'a'), 'https://tile.openstreetmap.org');
  // Where product photos and documents are served from (bucket, CDN or the test media host). Empty locally:
  // fake mode serves media through the API.
  const media = c.mediaOrigin ? origin(c.mediaOrigin, '') : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api} ${tiles} https://*.tile.openstreetmap.org ${media}`.trim(),
    "font-src 'self' data:",
    // MapLibre downloads tiles with fetch() (connect-src, not img-src) and runs its workers from blob: URLs.
    `connect-src 'self' ${api} ${api.replace(/^http/, 'ws')} ${tiles} https://*.tile.openstreetmap.org`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
