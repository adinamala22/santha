import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Telugu, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import tokens from '../../../../design/tokens/tailwind.tokens.js';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-poppins',
});

const telugu = Noto_Sans_Telugu({
  subsets: ['telugu'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-telugu',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Santha — The whole town, one app.', template: '%s · Santha' },
  description:
    'Groceries, medicines, sarees and home-cooked meals from Nellore shops and home kitchens, delivered in 30–45 minutes.',
  alternates: { languages: { en: '/', te: '/?lang=te' } },
};

export const viewport: Viewport = { themeColor: tokens.colors.indigo.DEFAULT };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${telugu.variable}`}>
      <body className="bg-white text-ink antialiased">{children}</body>
    </html>
  );
}
