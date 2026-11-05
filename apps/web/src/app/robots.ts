import type { MetadataRoute } from 'next';

import { connection } from 'next/server';
import { serverConfig } from '@/lib/runtime-config';


/** The console and staff delivery links are never indexed. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection(); // the site address is a runtime setting (one image for QA and PROD, ADR-025)
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/d/', '/api/'] }],
    sitemap: `${serverConfig().siteUrl}/sitemap.xml`,
  };
}
