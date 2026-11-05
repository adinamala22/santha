import type { Metadata } from 'next';
import { AcquisitionPage } from '@/components/site/acquisition-page';
import { langOf } from '@/components/site/site-chrome';
import { getSiteConfig } from '@/lib/site-config';

export const metadata: Metadata = { title: 'For stores — sell on Santha', alternates: { canonical: '/stores', languages: { en: '/stores', te: '/stores?lang=te' } } };

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { appDownloads } = await getSiteConfig();
  return <AcquisitionPage kind="store" lang={langOf((await searchParams).lang)} path="/stores" downloads={appDownloads} />;
}
