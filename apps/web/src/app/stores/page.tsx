import type { Metadata } from 'next';
import { AcquisitionPage } from '@/components/site/acquisition-page';
import { langOf } from '@/components/site/site-chrome';

export const metadata: Metadata = { title: 'For stores — sell on Santha', alternates: { canonical: '/stores', languages: { en: '/stores', te: '/stores?lang=te' } } };

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return <AcquisitionPage kind="store" lang={langOf((await searchParams).lang)} path="/stores" />;
}
