import { LeadForm } from '@/components/site/lead-form';
import { SiteFooter, SiteHeader } from '@/components/site/site-chrome';
import { siteCopy } from '@/i18n/site';

/** /stores, /home-kitchens, /riders: who it is for, three reasons, and the lead form. */
export function AcquisitionPage({ kind, lang, path }: { kind: 'store' | 'home_kitchen' | 'rider'; lang: 'en' | 'te'; path: string }) {
  const a = siteCopy(lang).acquisition[kind];
  return (
    <div lang={lang} className={lang === 'te' ? 'font-telugu' : undefined}>
      <SiteHeader lang={lang} path={path} />
      <main>
        <section className="bg-indigo text-white" aria-labelledby="page-title">
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            <h1 id="page-title" className="text-4xl font-bold leading-tight md:text-6xl">
              {a.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-ondarkmuted md:text-xl">{a.sub}</p>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-2">
          <ul className="space-y-6">
            {a.points.map((p, i) => (
              <li key={p} className="flex gap-4 rounded-xl bg-cream p-6">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-marigold font-bold text-indigo">
                  {i + 1}
                </span>
                <p className="text-lg text-ink">{p}</p>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border border-indigo-100 p-8 shadow-sm">
            <LeadForm kind={kind} lang={lang} />
          </div>
        </section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
