import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { langOf, SiteFooter, SiteHeader } from '@/components/site/site-chrome';
import { fill } from '@/i18n/console';
import { LEGAL_DOCS, type LegalDoc, siteCopy } from '@/i18n/site';

const UPDATED = '2026-11-03';

export function generateStaticParams() {
  return LEGAL_DOCS.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  if (!(LEGAL_DOCS as readonly string[]).includes(doc)) return {};
  return { title: siteCopy('en').legal[doc as LegalDoc].title, alternates: { canonical: `/legal/${doc}`, languages: { en: `/legal/${doc}`, te: `/legal/${doc}?lang=te` } } };
}

/** Privacy notice (DPDP), terms, grievance officer, FSSAI — English and Telugu. */
export default async function LegalPage({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { doc } = await params;
  if (!(LEGAL_DOCS as readonly string[]).includes(doc)) notFound();
  const lang = langOf((await searchParams).lang);
  const l = siteCopy(lang).legal;
  const page = l[doc as LegalDoc];
  return (
    <div lang={lang} className={lang === 'te' ? 'font-telugu' : undefined}>
      <SiteHeader lang={lang} path={`/legal/${doc}`} />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold text-indigo">{page.title}</h1>
        <p className="mt-2 text-sm text-slate">{fill(l.updated, { date: UPDATED })}</p>
        {page.sections.map(([heading, body]) => (
          <section key={heading} className="mt-10">
            <h2 className="text-xl font-bold text-ink">{heading}</h2>
            <p className="mt-3 leading-relaxed text-slate">{body}</p>
          </section>
        ))}
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
