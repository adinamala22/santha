import type { Metadata } from 'next';
import { AcquisitionPage } from '@/components/site/acquisition-page';
import { langOf } from '@/components/site/site-chrome';
import { getSiteConfig } from '@/lib/site-config';

export const metadata: Metadata = { title: 'Deliver with Santha', alternates: { canonical: '/riders', languages: { en: '/riders', te: '/riders?lang=te' } } };

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { appDownloads } = await getSiteConfig();
  return <AcquisitionPage kind="rider" lang={langOf((await searchParams).lang)} path="/riders" downloads={appDownloads} />;
}
