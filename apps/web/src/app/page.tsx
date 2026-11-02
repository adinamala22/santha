import Image from 'next/image';
import { CtaBand, langOf, SiteFooter, SiteHeader } from '@/components/site/site-chrome';
import { t } from '@/i18n/messages';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Landing (design/mockups/landing-page-desktop.png): hero with both apps, how it works, the stores band, legal footer. */
export default async function LandingPage({ searchParams }: { searchParams?: Promise<{ lang?: string }> }) {
  const lang = langOf((await searchParams)?.lang);
  const m = t(lang);
  const en = t('en');
  const te = t('te');
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Santha Technologies', url: SITE, logo: `${SITE}/brand/santha-primary.svg`, areaServed: 'Nellore, Andhra Pradesh, India' },
    { '@context': 'https://schema.org', '@type': 'MobileApplication', name: 'Santha', operatingSystem: 'ANDROID', applicationCategory: 'ShoppingApplication', offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' } },
  ];

  return (
    <div lang={lang} className={lang === 'te' ? 'font-telugu' : undefined}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader lang={lang} path="/" />
      <main>
        <section className="bg-indigo text-white" aria-labelledby="hero-title">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.4fr_1fr]">
            <div>
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
              <div id="download" className="mt-10 flex flex-wrap gap-4">
                {/* Plain buttons until the apps are live (store-badge rules). */}
                <a href="#download" className="s-focus rounded-lg bg-marigold px-10 py-4 text-lg font-medium text-indigo hover:bg-marigold-600">
                  {m.hero.android}
                </a>
                <a href="#download" className="s-focus rounded-lg bg-white px-6 py-4 text-lg font-medium text-indigo hover:bg-indigo-100">
                  {m.hero.iphone}
                </a>
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
