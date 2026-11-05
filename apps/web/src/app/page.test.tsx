import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteConfig } from '@/lib/site-config';
import LandingPage from './page';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

const config: { current: SiteConfig } = { current: { appDownloads: false, androidUrl: null, iosUrl: null } };
vi.mock('@/lib/site-config', () => ({ getSiteConfig: async () => config.current }));

describe('Landing', () => {
  beforeEach(() => {
    config.current = { appDownloads: false, androidUrl: null, iosUrl: null };
  });

  it('shows the tagline in English and Telugu with the 30–45 min promise', async () => {
    render(await LandingPage({}));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The whole town,one app.');
    expect(screen.getByText('ఊరు అంతా, ఒక్క యాప్ లో.')).toHaveAttribute('lang', 'te');
    expect(screen.getAllByText(/30–45 minutes/).length).toBeGreaterThan(0);
  });

  it('ADR-023: before launch, "Launching soon" instead of downloads, with a launch-list sign-up', async () => {
    render(await LandingPage({}));
    expect(screen.getByTestId('launch-badge')).toHaveTextContent('Launching soon in Nellore');
    expect(screen.getByRole('heading', { name: 'Coming soon on Android and iPhone' })).toBeInTheDocument();
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Launching soon' })).toHaveAttribute('href', '/#download'); // header CTA
    expect(screen.queryByRole('link', { name: 'Get it on Android' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download the app' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Tell me when it launches' })).toBeInTheDocument();
    // Not listed as a downloadable app yet.
    expect(document.querySelector('script[type="application/ld+json"]')?.textContent).not.toContain('MobileApplication');
  });

  it('ADR-023: once ops turn on app_downloads, the store links appear', async () => {
    config.current = { appDownloads: true, androidUrl: 'https://play.google.com/store/apps/details?id=app.santha.consumer', iosUrl: 'https://apps.apple.com/in/app/santha/id1' };
    render(await LandingPage({}));
    expect(screen.getByRole('link', { name: 'Get it on Android' })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=app.santha.consumer');
    expect(screen.getByRole('link', { name: 'Get it on iPhone' })).toHaveAttribute('href', 'https://apps.apple.com/in/app/santha/id1');
    expect(screen.getByRole('link', { name: 'Download the app' })).toBeInTheDocument();
    expect(screen.queryByTestId('launch-badge')).toBeNull();
    expect(screen.queryByRole('form', { name: 'Tell me when it launches' })).toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')?.textContent).toContain('MobileApplication');
  });

  it('links the store / kitchen sign-up pages and the legal pages', async () => {
    render(await LandingPage({}));
    expect(screen.getByRole('link', { name: 'Register your store' })).toHaveAttribute('href', '/stores');
    expect(screen.getByRole('link', { name: 'Register a home kitchen' })).toHaveAttribute('href', '/home-kitchens');
    for (const [name, href] of [['Privacy', '/legal/privacy'], ['Terms', '/legal/terms'], ['Grievance officer', '/legal/grievance']])
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('renders in Telugu with ?lang=te, "launching soon" too', async () => {
    render(await LandingPage({ searchParams: Promise.resolve({ lang: 'te' }) }));
    expect(screen.getByRole('heading', { level: 1 }).closest('[lang]')).toHaveAttribute('lang', 'te');
    expect(screen.getByRole('link', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByTestId('launch-badge')).toHaveTextContent('నెల్లూరులో త్వరలో ప్రారంభం');
    expect(screen.getByRole('heading', { name: 'త్వరలో Android మరియు iPhone లో' })).toBeInTheDocument();
  });
});
