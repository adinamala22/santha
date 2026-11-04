import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import tokens from '../../../../design/tokens/tailwind.tokens.js';
import './globals.css';

// Self-hosted (the same files the apps ship, copied from packages/santha_ui/fonts by sync:brand): builds
// never fetch Google Fonts, which made the ARM image build fail now and then.
const poppins = localFont({
  src: [
    { path: './fonts/Poppins-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/Poppins-Medium.ttf', weight: '500', style: 'normal' },
    { path: './fonts/Poppins-Bold.ttf', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-poppins',
});

// Variable font: one file for every weight.
const telugu = localFont({
  src: './fonts/NotoSansTelugu.ttf',
  weight: '100 900',
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
