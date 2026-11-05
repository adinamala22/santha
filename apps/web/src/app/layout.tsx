import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import tokens from '../../../../design/tokens/tailwind.tokens.js';
import { configScript, serverConfig } from '@/lib/runtime-config';
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

// One image for QA and PROD (ADR-025): the site and API addresses are runtime settings, so pages render on request
// (connection()), never baked in at build time. Each fetch keeps its own revalidate in the data cache.
export const generateMetadata = async (): Promise<Metadata> => {
  await connection();
  return {
    metadataBase: new URL(serverConfig().siteUrl),
    title: { default: 'Santha — The whole town, one app.', template: '%s · Santha' },
    description:
      'Groceries, medicines, sarees and home-cooked meals from Nellore shops and home kitchens, delivered in 30–45 minutes.',
    alternates: { languages: { en: '/', te: '/?lang=te' } },
  };
};

export const viewport: Viewport = { themeColor: tokens.colors.indigo.DEFAULT };

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en" className={`${poppins.variable} ${telugu.variable}`}>
      <head>
        {/* Public runtime settings for client components (lib/runtime-config.ts). */}
        <script dangerouslySetInnerHTML={{ __html: configScript() }} />
      </head>
      <body className="bg-white text-ink antialiased">{children}</body>
    </html>
  );
}
