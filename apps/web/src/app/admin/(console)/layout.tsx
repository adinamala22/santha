import type { Metadata } from 'next';
import Image from 'next/image';
import { type ReactNode, Suspense } from 'react';
import { LangSwitch } from '@/components/admin/lang-switch';
import { NavLink } from '@/components/admin/nav-link';
import { catalogueCopy } from '@/i18n/catalogue';
import { consoleCopy } from '@/i18n/console';
import { liveCopy } from '@/i18n/live';
import { orderCopy } from '@/i18n/orders';
import { promoCopy } from '@/i18n/promos';
import { opsLocale, opsSession } from '@/lib/ops/server';

export const metadata: Metadata = { title: { default: 'Ops console', template: '%s · Santha Ops' }, robots: { index: false, follow: false } };

/** Console shell — left indigo nav and a light canvas (design/mockups/admin-dashboard-desktop.png). */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  return (
    <div lang={locale} className="flex min-h-screen bg-sky/40">
      <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col bg-indigo px-6 py-10">
        <Image src="/brand/santha-primary-reverse.svg" alt="Santha" width={180} height={52} priority className="ml-4 h-auto w-[180px]" />
        <nav aria-label="Console" className="mt-12 space-y-2">
          <NavLink href="/admin" exact>
            {copy.nav.overview}
          </NavLink>
          <NavLink href="/admin/live">{liveCopy(locale).nav}</NavLink>
          <NavLink href="/admin/orders">{orderCopy(locale).nav}</NavLink>
          <NavLink href="/admin/merchants">{copy.nav.merchants}</NavLink>
          <NavLink href="/admin/catalogue">{catalogueCopy(locale).nav}</NavLink>
          <NavLink href="/admin/promos">{promoCopy(locale).nav}</NavLink>
          <NavLink href="/admin/micro-markets">{copy.nav.microMarkets}</NavLink>
          <NavLink href="/admin/audit">{copy.nav.audit}</NavLink>
        </nav>
        <div className="mt-auto space-y-3">
          <Suspense>
            <LangSwitch to={locale === 'te' ? 'en' : 'te'} label={copy.nav.language} />
          </Suspense>
          <div className="rounded-md bg-white/10 px-6 py-4">
            <p className="font-medium text-white">{session?.roles.filter((r) => r !== 'consumer').join(' · ') || 'ops'}</p>
            <form action="/api/ops/logout" method="post" className="mt-1">
              <p className="text-sm text-ondarkmuted">
                {copy.nav.city} ·{' '}
                <button type="submit" className="s-focus hover:text-white hover:underline">
                  {copy.nav.signOut}
                </button>
              </p>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-12 py-10">{children}</main>
    </div>
  );
}
