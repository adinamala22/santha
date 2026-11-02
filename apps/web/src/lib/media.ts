/**
 * Image URLs from the API are absolute (CDN / RustFS) or, in fake mode, API-relative paths such as
 * `/v1/dev/media/…`. The browser loads them, so relative ones resolve against the public API URL.
 */
export function mediaSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('/')) return url;
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}${url}`;
}
