import type { Metadata } from 'next';
import { AcquisitionPage } from '@/components/site/acquisition-page';
import { langOf } from '@/components/site/site-chrome';
import { getSiteConfig } from '@/lib/site-config';

export const metadata: Metadata = { title: 'For home kitchens — sell on Santha', alternates: { canonical: '/home-kitchens', languages: { en: '/home-kitchens', te: '/home-kitchens?lang=te' } } };

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { appDownloads } = await getSiteConfig();
  return <AcquisitionPage kind="home_kitchen" lang={langOf((await searchParams).lang)} path="/home-kitchens" downloads={appDownloads} />;
}
