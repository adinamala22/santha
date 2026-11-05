import Image from 'next/image';
import Link from 'next/link';
import { t } from '@/i18n/messages';
import { siteCopy } from '@/i18n/site';

type Lang = 'en' | 'te';
export const langOf = (v: string | string[] | undefined): Lang => (v === 'te' ? 'te' : 'en');
const withLang = (href: string, lang: Lang) => (lang === 'te' ? `${href}${href.includes('?') ? '&' : '?'}lang=te` : href);

/**
 * Public site header (landing mockup): logo, section links, language switch, and the download CTA, which reads
 * "Launching soon" until the apps are in the stores (flag app_downloads, ADR-023).
 */
export function SiteHeader({ lang = 'en', path = '/', downloads = false }: { lang?: Lang; path?: string; downloads?: boolean }) {
  const m = t(lang);
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-6">
      <Link href={withLang('/', lang)} aria-label="Santha home" className="s-focus rounded-sm">
        <Image src="/brand/santha-primary.svg" alt="Santha" width={160} height={48} priority />
      </Link>
      <nav aria-label="Main" className="hidden items-center gap-8 text-[15px] text-ink lg:flex">
        <Link href={withLang('/#how', lang)} className="s-focus hover:text-indigo">
          {m.nav.how}
        </Link>
        <Link href={withLang('/stores', lang)} className="s-focus hover:text-indigo">
          {m.nav.stores}
        </Link>
        <Link href={withLang('/home-kitchens', lang)} className="s-focus hover:text-indigo">
          {m.nav.kitchens}
        </Link>
        <Link href={withLang('/riders', lang)} className="s-focus hover:text-indigo">
          {m.nav.riders}
        </Link>
      </nav>
      <div className="flex items-center gap-4">
        <Link href={lang === 'te' ? path : `${path}${path.includes('?') ? '&' : '?'}lang=te`} lang={lang === 'te' ? 'en' : 'te'} className="s-focus text-sm text-indigo hover:underline">
          {lang === 'te' ? 'English' : 'తెలుగు'}
        </Link>
        <a href={withLang('/#download', lang)} className="s-focus rounded-pill bg-marigold px-6 py-3 font-medium text-indigo hover:bg-marigold-600">
          {downloads ? m.nav.download : siteCopy(lang).prelaunch.navCta}
        </a>
      </div>
    </header>
  );
}

/** Footer with the legal links (privacy, terms, grievance officer, FSSAI). */
export function SiteFooter({ lang = 'en' }: { lang?: Lang }) {
  const m = t(lang);
  const legal = siteCopy(lang).legal;
  return (
    <footer className="bg-indigo text-ondarkmuted">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-10">
        <Image src="/brand/santha-primary-reverse.svg" alt="Santha" width={140} height={42} />
        <nav aria-label="Legal" className="text-sm">
          © {new Date().getFullYear()} {m.footer.rights} ·{' '}
          <Link href={withLang('/legal/privacy', lang)} className="s-focus hover:text-white hover:underline">
            {m.footer.privacy}
          </Link>{' '}
          ·{' '}
          <Link href={withLang('/legal/terms', lang)} className="s-focus hover:text-white hover:underline">
            {m.footer.terms}
          </Link>{' '}
          ·{' '}
          <Link href={withLang('/legal/grievance', lang)} className="s-focus hover:text-white hover:underline">
            {m.footer.grievance}
          </Link>{' '}
          ·{' '}
          <Link href={withLang('/legal/fssai', lang)} className="s-focus hover:text-white hover:underline">
            {legal.fssai.title}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** "Run a shop or a home kitchen in Nellore?" band (landing mockup). */
export function CtaBand({ lang = 'en' }: { lang?: Lang }) {
  const c = siteCopy(lang).cta;
  return (
    <section className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby="cta-title">
      <div className="flex flex-wrap items-center justify-between gap-8 rounded-xl bg-sky p-10 md:p-14">
        <div className="max-w-3xl">
          <h2 id="cta-title" className="text-3xl font-bold text-indigo md:text-4xl">
            {c.title}
          </h2>
          <p className="mt-4 text-lg text-slate">{c.body}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href={withLang('/stores', lang)} className="s-focus rounded-pill bg-indigo px-8 py-4 font-medium text-white hover:bg-indigo-700">
              {c.store}
            </Link>
            <Link href={withLang('/home-kitchens', lang)} className="s-focus rounded-pill border-2 border-indigo px-8 py-4 font-medium text-indigo hover:bg-white">
              {c.kitchen}
            </Link>
          </div>
        </div>
        <Image src="/brand/santha-mark.svg" alt="" width={160} height={200} className="hidden h-auto w-40 md:block" />
      </div>
    </section>
  );
}
