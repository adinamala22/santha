import type { PublicStore } from '@santha/shared-types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RatingBars } from '@/components/site/rating-bars';
import { langOf, SiteFooter, SiteHeader } from '@/components/site/site-chrome';
import { fill } from '@/i18n/console';
import { siteCopy } from '@/i18n/site';
import { serverApiUrl } from '@/lib/api';
import { getSiteConfig } from '@/lib/site-config';
import { rupees } from '@/lib/format';

export const revalidate = 300;

type StoreItems = { items: Array<{ id: string; name: string; nameTe: string | null; imageUrl: string | null; variants: Array<{ label: string; pricePaise: number }> }> };

async function load(slug: string): Promise<{ store: PublicStore; items: StoreItems['items'] } | null> {
  const res = await fetch(`${serverApiUrl()}/v1/public/stores/${encodeURIComponent(slug)}`, { next: { revalidate: 300 } }).catch(() => null);
  if (!res?.ok) return null;
  const store = (await res.json()) as PublicStore;
  const loc = store.location;
  const itemsRes = loc ? await fetch(`${serverApiUrl()}/v1/stores/${store.id}?lat=${loc.lat}&lng=${loc.lng}`, { next: { revalidate: 300 } }).catch(() => null) : null;
  const items = itemsRes?.ok ? ((await itemsRes.json()) as StoreItems).items : [];
  return { store, items };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) return { title: 'Store not found', robots: { index: false } };
  const desc = `${d.store.description ?? ''} Order from ${d.store.name} on Santha — delivered in 30–45 minutes in ${d.store.area ?? 'Nellore'}.`.trim();
  return {
    title: `${d.store.name} · ${d.store.area ?? 'Nellore'}`,
    description: desc,
    alternates: { canonical: `/s/${slug}` },
    openGraph: { title: d.store.name, description: desc, url: `/s/${slug}`, siteName: 'Santha', type: 'website', locale: 'en_IN', images: ['/brand/santha-primary.svg'] },
  };
}

/** Public store link page (/s/{slug}): shareable by the store on WhatsApp; SSR with OG tags and a deep link into the app. */
export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug } = await params;
  const lang = langOf((await searchParams).lang);
  const [d, site] = await Promise.all([load(slug), getSiteConfig()]);
  if (!d) notFound();
  const s = siteCopy(lang).store;
  const pre = siteCopy(lang).prelaunch;
  const st = d.store;
  const name = String(lang === 'te' && st.nameTe ? st.nameTe : st.name);
  const area = String((lang === 'te' && st.areaTe ? st.areaTe : st.area) ?? 'Nellore');
  const deepLink = `santha://store/${st.id}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: st.name,
    address: { '@type': 'PostalAddress', addressLocality: 'Nellore', addressRegion: 'Andhra Pradesh', addressCountry: 'IN' },
    ...(st.rating.avg != null && st.rating.count > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: st.rating.avg.toFixed(1), reviewCount: st.rating.count } } : {}),
  };
  return (
    <div lang={lang} className={lang === 'te' ? 'font-telugu' : undefined}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader lang={lang} path={`/s/${slug}`} downloads={site.appDownloads} />
      <main>
        <section className="bg-indigo text-white">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <p className="text-sm uppercase tracking-wide text-marigold">{s.types[st.type as keyof typeof s.types] ?? st.type}</p>
            <h1 className="mt-2 text-4xl font-bold md:text-5xl" data-testid="store-name">
              {name}
            </h1>
            {st.description ? <p className="mt-4 max-w-3xl text-lg text-ondarkmuted">{st.description}</p> : null}
            <p className="mt-4 text-ondarkmuted">{fill(s.delivers, { area: String(area ?? 'Nellore') })}</p>
            <p className="mt-2 text-marigold" data-testid="store-rating">
              {st.rating.avg != null && st.rating.count > 0 ? fill(s.rating, { avg: st.rating.avg.toFixed(1), count: st.rating.count }) : s.noRating}
            </p>
            {site.appDownloads ? (
              <div className="mt-8 flex flex-wrap gap-4">
                <a href={deepLink} className="s-focus rounded-lg bg-marigold px-8 py-4 text-lg font-medium text-indigo hover:bg-marigold-600">
                  {s.openInApp}
                </a>
                <Link href="/#download" className="s-focus rounded-lg bg-white px-6 py-4 text-lg font-medium text-indigo hover:bg-indigo-100">
                  {s.order}
                </Link>
              </div>
            ) : (
              // Before launch (ADR-023): no dead app links; send people to the launch list instead.
              <div className="mt-8" data-testid="store-coming-soon">
                <p className="text-lg font-medium">{pre.title}</p>
                <Link href={lang === 'te' ? '/?lang=te#download' : '/#download'} className="s-focus mt-4 inline-block rounded-lg bg-marigold px-8 py-4 text-lg font-medium text-indigo hover:bg-marigold-600">
                  {pre.formTitle}
                </Link>
              </div>
            )}
          </div>
        </section>
        {d.items.length ? (
          <section className="mx-auto max-w-6xl px-6 py-14" aria-labelledby="items-title">
            <h2 id="items-title" className="text-2xl font-bold text-indigo">
              {s.items}
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.items.slice(0, 12).map((i) => (
                <li key={i.id} className="rounded-lg border border-indigo-100 p-4">
                  <p className="font-medium text-ink">{lang === 'te' && i.nameTe ? i.nameTe : i.name}</p>
                  {i.variants[0] ? (
                    <p className="text-sm text-slate">
                      {i.variants[0].label} · {rupees(i.variants[0].pricePaise)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {st.rating.count > 0 ? (
          <section className="mx-auto max-w-6xl px-6 pb-10" aria-labelledby="breakdown-title">
            <h2 id="breakdown-title" className="text-2xl font-bold text-indigo">
              {s.breakdownTitle}
            </h2>
            <RatingBars distribution={st.rating.distribution} label={(stars, count) => fill(s.starBar, { stars, count })} />
          </section>
        ) : null}
        {st.reviews.length ? (
          <section className="mx-auto max-w-6xl px-6 pb-16" aria-labelledby="reviews-title">
            <h2 id="reviews-title" className="text-2xl font-bold text-indigo">
              {s.reviews}
            </h2>
            <ul className="mt-6 space-y-4">
              {st.reviews.map((r, i) => (
                <li key={i} className="rounded-lg bg-cream p-5" data-testid="review">
                  <p className="text-marigold-600" aria-label={`${r.storeStars} / 5`}>
                    {'★'.repeat(r.storeStars)}
                    {'☆'.repeat(5 - r.storeStars)}
                  </p>
                  <p className="mt-2 text-ink">{String(r.comment ?? '')}</p>
                  {r.reply ? (
                    <p className="mt-3 border-l-4 border-indigo-100 pl-3 text-sm text-slate">
                      <span className="font-medium text-indigo">{s.reply}: </span>
                      {String(r.reply)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
