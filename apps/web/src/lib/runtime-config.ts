/**
 * Per-environment website settings, read while the server runs, not at build time (ADR-025): one website image
 * serves QA and PROD. The server reads them from its environment; the root layout hands the public ones to the
 * browser (window.__SANTHA__), so client components use the same values.
 *
 *   SITE_URL        this website's address (canonical links, sitemap, OG tags)
 *   PUBLIC_API_URL  the API address browsers call (lead forms, staff delivery page, media in fake mode)
 *   MEDIA_ORIGIN    where photos are served from (bucket / CDN); empty when the API serves them
 *   MAP_TILES_URL   raster tiles for the console maps; empty = OpenStreetMap (ADR-007)
 * The older NEXT_PUBLIC_* names still work locally (read at runtime too, never inlined).
 */
export interface PublicConfig {
  siteUrl: string;
  apiUrl: string;
  mediaOrigin: string;
  tilesUrl: string;
}

declare global {
  interface Window {
    __SANTHA__?: PublicConfig;
  }
}

// Dynamic lookups: Next.js inlines only literal `process.env.NEXT_PUBLIC_X` reads, so these stay runtime values.
const env = (...keys: string[]): string | undefined => {
  if (typeof process === 'undefined' || !process.env) return undefined;
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
};

/** Server side (pages, route handlers, middleware): the process environment, now. */
export function serverConfig(): PublicConfig {
  return {
    siteUrl: env('SITE_URL', 'NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000',
    apiUrl: env('PUBLIC_API_URL', 'NEXT_PUBLIC_API_URL') ?? 'http://localhost:4000',
    mediaOrigin: env('MEDIA_ORIGIN', 'NEXT_PUBLIC_MEDIA_ORIGIN') ?? '',
    tilesUrl: env('MAP_TILES_URL', 'NEXT_PUBLIC_MAP_TILES_URL') ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  };
}

/** Either side: in the browser, what the root layout injected; on the server, the environment. */
export function publicConfig(): PublicConfig {
  if (typeof window !== 'undefined' && window.__SANTHA__) return window.__SANTHA__;
  return serverConfig();
}

/** Script for the root layout: makes the public settings available to client components before they run. */
export function configScript(): string {
  // JSON in a script: escape "<" so a value can never close the tag.
  return `window.__SANTHA__=${JSON.stringify(serverConfig()).replace(/</g, '\\u003c')};`;
}
