import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './page';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

describe('Landing', () => {
  it('shows the tagline in English and Telugu with the 30–45 min promise', async () => {
    render(await LandingPage({}));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The whole town,one app.');
    expect(screen.getByText('ఊరు అంతా, ఒక్క యాప్ లో.')).toHaveAttribute('lang', 'te');
    expect(screen.getAllByText(/30–45 minutes/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Get it on Android' })).toBeInTheDocument();
  });

  it('links the store / kitchen sign-up pages and the legal pages', async () => {
    render(await LandingPage({}));
    expect(screen.getByRole('link', { name: 'Register your store' })).toHaveAttribute('href', '/stores');
    expect(screen.getByRole('link', { name: 'Register a home kitchen' })).toHaveAttribute('href', '/home-kitchens');
    for (const [name, href] of [['Privacy', '/legal/privacy'], ['Terms', '/legal/terms'], ['Grievance officer', '/legal/grievance']])
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('renders in Telugu with ?lang=te', async () => {
    render(await LandingPage({ searchParams: Promise.resolve({ lang: 'te' }) }));
    expect(screen.getByRole('heading', { level: 1 }).closest('[lang]')).toHaveAttribute('lang', 'te');
    expect(screen.getByRole('link', { name: 'English' })).toBeInTheDocument();
  });
});
