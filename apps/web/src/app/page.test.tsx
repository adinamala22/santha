import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './page';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

describe('Landing placeholder', () => {
  it('shows the tagline in English and Telugu with the 30–45 min promise', () => {
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The whole town,one app.');
    expect(screen.getByText('ఊరు అంతా, ఒక్క యాప్ లో.')).toHaveAttribute('lang', 'te');
    expect(screen.getAllByText(/30–45 minutes/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Get it on Android' })).toBeInTheDocument();
  });
});
