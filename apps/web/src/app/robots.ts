import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** The console and staff delivery links are never indexed. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/d/', '/api/'] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
