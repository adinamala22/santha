import type { Metadata } from 'next';
import Image from 'next/image';
import { t } from '@/i18n/messages';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Ops sign in', robots: { index: false, follow: false } };

/** Matches design/mockups/admin-login-desktop.png. */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const copy = t('en').admin;
  return (
    <div className="grid min-h-screen bg-indigo lg:grid-cols-2">
      <section aria-label={copy.productName} className="relative hidden items-center bg-white/10 px-[10%] lg:flex">
        <div>
          <Image src="/brand/santha-mark-reverse.svg" alt="" width={300} height={400} priority className="h-auto w-[300px]" />
          <p className="mt-16 text-6xl font-bold text-white">{copy.productName}</p>
          <p className="mt-6 text-2xl text-ondarkmuted">{copy.productBlurb}</p>
          <p className="mt-3 text-xl text-indigo-300">{copy.productScope}</p>
        </div>
      </section>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[660px] rounded-xl bg-white p-10 shadow-sheet sm:p-14">
          <LoginForm copy={copy} next={next} />
        </div>
      </main>
    </div>
  );
}
