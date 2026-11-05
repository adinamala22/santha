import Image from 'next/image';
import { LaunchSignup } from '@/components/site/launch-signup';
import { CtaBand, langOf, SiteFooter, SiteHeader } from '@/components/site/site-chrome';
import { t } from '@/i18n/messages';
import { siteCopy } from '@/i18n/site';
import { getSiteConfig } from '@/lib/site-config';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Landing (design/mockups/landing-page-desktop.png): hero with both apps, how it works, the stores band, legal footer. */
export default async function LandingPage({ searchParams }: { searchParams?: Promise<{ lang?: string }> }) {
  const lang = langOf((await searchParams)?.lang);
  const site = await getSiteConfig();
  const m = t(lang);
  const p = siteCopy(lang).prelaunch;
  const en = t('en');
  const te = t('te');
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Santha Technologies', url: SITE, logo: `${SITE}/brand/santha-primary.svg`, areaServed: 'Nellore, Andhra Pradesh, India' },
    // The app only becomes a listed MobileApplication once it can be downloaded.
    ...(site.appDownloads
      ? [{ '@context': 'https://schema.org', '@type': 'MobileApplication', name: 'Santha', operatingSystem: 'ANDROID', applicationCategory: 'ShoppingApplication', offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' } }]
      : []),
  ];

  return (
    <div lang={lang} className={lang === 'te' ? 'font-telugu' : undefined}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader lang={lang} path="/" downloads={site.appDownloads} />
      <main>
        <section className="bg-indigo text-white" aria-labelledby="hero-title">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.4fr_1fr]">
            <div>
              {!site.appDownloads ? (
                <p data-testid="launch-badge" className="mb-6 inline-flex items-center gap-2 rounded-pill bg-marigold px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-indigo">
                  <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-indigo motion-reduce:animate-none" />
                  {p.badge}
                </p>
              ) : null}
              <h1 id="hero-title" className="text-5xl font-bold leading-tight md:text-7xl">
                {m.brand.taglineLine1}
                <br />
                <span className="text-marigold">{m.brand.taglineLine2}</span>
              </h1>
              {lang === 'en' ? (
                <p lang="te" className="mt-4 font-telugu text-3xl text-ondarkmuted md:text-4xl">
                  {te.brand.tagline}
                </p>
              ) : null}
              <p className="mt-8 max-w-3xl text-lg text-ondarkmuted md:text-xl">{m.hero.body}</p>
              <div id="download" className="mt-10 scroll-mt-6">
                {site.appDownloads ? (
                  <div className="flex flex-wrap gap-4">
                    <a href={site.androidUrl ?? '#download'} className="s-focus rounded-lg bg-marigold px-10 py-4 text-lg font-medium text-indigo hover:bg-marigold-600">
                      {m.hero.android}
                    </a>
                    <a href={site.iosUrl ?? '#download'} className="s-focus rounded-lg bg-white px-6 py-4 text-lg font-medium text-indigo hover:bg-indigo-100">
                      {m.hero.iphone}
                    </a>
                  </div>
                ) : (
                  <div data-testid="coming-soon" className="space-y-5">
                    <div>
                      <h2 className="text-2xl font-bold">{p.title}</h2>
                      <p className="mt-2 max-w-2xl text-ondarkmuted">{p.body}</p>
                    </div>
                    <ul className="flex flex-wrap gap-3" aria-label={p.title}>
                      {[
                        ['android', p.android],
                        ['iphone', p.iphone],
                      ].map(([key, label]) => (
                        <li key={key} className="flex items-center gap-3 rounded-lg border border-white/30 px-5 py-3">
                          <PlatformIcon platform={key as 'android' | 'iphone'} />
                          <span>
                            <span className="block text-xs uppercase tracking-wide text-marigold">{p.soon}</span>
                            <span className="block text-lg font-medium">{label}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <LaunchSignup lang={lang} />
                  </div>
                )}
              </div>
              <p className="mt-10 text-indigo-300">{m.hero.facts}</p>
            </div>
            <div className="relative hidden h-[520px] lg:block" aria-hidden>
              <Image src="/mockups/consumer-home-hifi.png" alt="" width={260} height={560} priority className="absolute left-0 top-0 h-auto w-[240px] rounded-xl shadow-2xl" />
              <Image src="/mockups/merchant-orders-hifi.png" alt="" width={220} height={474} className="absolute bottom-0 right-0 h-auto w-[200px] rounded-xl shadow-2xl" />
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-6 py-20" aria-labelledby="how-title">
          <h2 id="how-title" className="text-center text-4xl font-bold text-indigo">
            {m.how.title}
          </h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {m.how.steps.map((step, i) => (
              <li key={step.title} className="rounded-xl bg-cream p-8">
                <div className="flex items-center gap-4">
                  <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-marigold text-xl font-bold text-indigo">
                    {i + 1}
                  </span>
                  <h3 className="text-xl font-bold text-indigo">{step.title}</h3>
                </div>
                <p className="mt-5 text-slate">{step.body}</p>
                {lang === 'en' ? (
                  <p lang="te" className="mt-3 font-telugu text-sm text-slate">
                    {te.how.steps[i]?.body}
                  </p>
                ) : (
                  <p lang="en" className="mt-3 text-sm text-slate">
                    {en.how.steps[i]?.body}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <CtaBand lang={lang} />
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}

/** Simple platform marks (not store badges: those may only be used once the app is listed). */
function PlatformIcon({ platform }: { platform: 'android' | 'iphone' }) {
  return (
    <svg aria-hidden width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-white">
      {platform === 'android' ? (
        <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22A11.4 11.4 0 0 0 12 8.08c-1.77 0-3.43.39-4.92 1.06L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
      ) : (
        <path d="M16.5 1.5h-9A2.5 2.5 0 0 0 5 4v16a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 20V4a2.5 2.5 0 0 0-2.5-2.5zM12 21a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 12 21zm5-4.5H7V4h10v12.5z" />
      )}
    </svg>
  );
}
