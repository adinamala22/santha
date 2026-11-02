import type { MetadataRoute } from 'next';
import { API_URL } from '@/lib/api';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Public pages in English and Telugu, plus every live store link page. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ['/', '/stores', '/home-kitchens', '/riders', '/legal/privacy', '/legal/terms', '/legal/grievance', '/legal/fssai'];
  const out: MetadataRoute.Sitemap = pages.map((p) => ({
    url: `${SITE}${p}`,
    changeFrequency: p === '/' ? 'weekly' : 'monthly',
    priority: p === '/' ? 1 : 0.6,
    alternates: { languages: { en: `${SITE}${p}`, te: `${SITE}${p}?lang=te` } },
  }));
  const res = await fetch(`${API_URL}/v1/public/stores`, { next: { revalidate: 3600 } }).catch(() => null);
  if (res?.ok) for (const st of ((await res.json()) as { items: Array<{ slug: string; updatedAt: string }> }).items) out.push({ url: `${SITE}/s/${st.slug}`, lastModified: st.updatedAt, changeFrequency: 'daily', priority: 0.5 });
  return out;
}
