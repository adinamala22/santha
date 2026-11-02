import type { Metadata } from 'next';
import { AcquisitionPage } from '@/components/site/acquisition-page';
import { langOf } from '@/components/site/site-chrome';

export const metadata: Metadata = { title: 'Deliver with Santha', alternates: { canonical: '/riders', languages: { en: '/riders', te: '/riders?lang=te' } } };

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return <AcquisitionPage kind="rider" lang={langOf((await searchParams).lang)} path="/riders" />;
}
