import Image from 'next/image';
import Link from 'next/link';
import { t } from '@/i18n/messages';

/** Placeholder landing (M0). The full marketing site — sections, lead forms, SEO — is built in M8. */
export default function LandingPage() {
  const en = t('en');
  const te = t('te');

  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" aria-label="Santha home" className="s-focus rounded-sm">
          <Image src="/brand/santha-primary.svg" alt="Santha" width={160} height={48} priority />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-10 text-[15px] text-ink lg:flex">
          <a href="#how" className="s-focus hover:text-indigo">{en.nav.how}</a>
          <span className="text-slate">{en.nav.stores}</span>
          <span className="text-slate">{en.nav.kitchens}</span>
          <span className="text-slate">{en.nav.riders}</span>
        </nav>
        <a
          href="#download"
          className="s-focus rounded-pill bg-marigold px-6 py-3 font-medium text-indigo hover:bg-marigold-600"
        >
          {en.nav.download}
        </a>
      </header>

      <main>
        <section className="bg-indigo text-white" aria-labelledby="hero-title">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <h1 id="hero-title" className="text-5xl font-bold leading-tight md:text-7xl">
              {en.brand.taglineLine1}
              <br />
              <span className="text-marigold">{en.brand.taglineLine2}</span>
            </h1>
            <p lang="te" className="mt-4 font-telugu text-3xl text-ondarkmuted md:text-4xl">
              {te.brand.tagline}
            </p>
            <p className="mt-8 max-w-3xl text-lg text-ondarkmuted md:text-xl">{en.hero.body}</p>
            <p lang="te" className="mt-2 max-w-3xl font-telugu text-base text-indigo-300">
              {te.hero.body}
            </p>
            <div id="download" className="mt-10 flex flex-wrap gap-4">
              <a
                href="#download"
                className="s-focus rounded-lg bg-marigold px-10 py-4 text-lg font-medium text-indigo hover:bg-marigold-600"
              >
                {en.hero.android}
              </a>
              <a
                href="#download"
                className="s-focus rounded-lg bg-white px-6 py-4 text-lg font-medium text-indigo hover:bg-indigo-100"
              >
                {en.hero.iphone}
              </a>
            </div>
            <p className="mt-10 text-indigo-300">{en.hero.facts}</p>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-6 py-20" aria-labelledby="how-title">
          <h2 id="how-title" className="text-center text-4xl font-bold text-indigo">
            {en.how.title}
          </h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {en.how.steps.map((step, i) => (
              <li key={step.title} className="rounded-xl bg-cream p-8">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-marigold text-xl font-bold text-indigo"
                  >
                    {i + 1}
                  </span>
                  <h3 className="text-xl font-bold text-indigo">{step.title}</h3>
                </div>
                <p className="mt-5 text-slate">{step.body}</p>
                <p lang="te" className="mt-3 font-telugu text-sm text-slate">
                  {te.how.steps[i]?.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="bg-indigo text-ondarkmuted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-10">
          <Image src="/brand/santha-primary-reverse.svg" alt="Santha" width={140} height={42} />
          <p className="text-sm">
            © {new Date().getFullYear()} {en.footer.rights} · {en.footer.privacy} · {en.footer.terms} ·{' '}
            {en.footer.grievance}
          </p>
        </div>
      </footer>
    </>
  );
}
