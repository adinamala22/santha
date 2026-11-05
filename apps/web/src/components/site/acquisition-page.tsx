import { LeadForm } from '@/components/site/lead-form';
import { SiteFooter, SiteHeader } from '@/components/site/site-chrome';
import { StoreLeadForm } from '@/components/site/store-lead-form';
import { siteCopy } from '@/i18n/site';

/**
 * /stores, /home-kitchens, /riders: who it is for, three reasons, and the lead form. Before launch (flag
 * app_downloads off) /stores becomes the launch sign-up: why to join now, and a form with a live preview of the
 * shop card customers will see (ADR-023).
 */
export function AcquisitionPage({ kind, lang, path, downloads = false }: { kind: 'store' | 'home_kitchen' | 'rider'; lang: 'en' | 'te'; path: string; downloads?: boolean }) {
  const copy = siteCopy(lang);
  const a = copy.acquisition[kind];
  const prelaunchStore = kind === 'store' && !downloads;
  const s = copy.storeLaunch;
  return (
    <div lang={lang} className={lang === 'te' ? 'font-telugu' : undefined}>
      <SiteHeader lang={lang} path={path} downloads={downloads} />
      <main>
        <section className="bg-indigo text-white" aria-labelledby="page-title">
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            {prelaunchStore ? (
              <p data-testid="store-launch-badge" className="mb-6 inline-flex items-center gap-2 rounded-pill bg-marigold px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-indigo">
                <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-indigo motion-reduce:animate-none" />
                {s.badge}
              </p>
            ) : null}
            <h1 id="page-title" className="text-4xl font-bold leading-tight md:text-6xl">
              {prelaunchStore ? s.title : a.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-ondarkmuted md:text-xl">{prelaunchStore ? s.sub : a.sub}</p>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-2">
          <div className="space-y-6">
            {prelaunchStore ? (
              <div data-testid="store-miss" className="rounded-xl border-l-4 border-marigold bg-sky p-6">
                <h2 className="text-xl font-bold text-indigo">{s.missTitle}</h2>
                <p className="mt-3 text-lg text-ink">{s.missBody}</p>
              </div>
            ) : null}
            <ul className="space-y-6">
              {[...a.points, ...(prelaunchStore ? [s.setup] : [])].map((pt, i) => (
                <li key={pt} className="flex gap-4 rounded-xl bg-cream p-6">
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-marigold font-bold text-indigo">
                    {i + 1}
                  </span>
                  <p className="text-lg text-ink">{pt}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-indigo-100 p-8 shadow-sm">{kind === 'store' ? <StoreLeadForm lang={lang} prelaunch={prelaunchStore} /> : <LeadForm kind={kind} lang={lang} />}</div>
        </section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
