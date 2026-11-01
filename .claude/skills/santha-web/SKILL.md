---
name: santha-web
description: How to build the Santha Next.js web app — the public landing/marketing site, per-merchant store link pages, and the ops/admin console with login, RBAC, live orders map, merchant onboarding queue, catalogue QA, payouts, refunds and micro-market editor. Use for any task under apps/web, for SEO/landing copy, or for admin UI and auth.
---

# Santha web (apps/web)

Next.js 15 App Router · TypeScript · Tailwind with `design/tokens/tailwind.tokens.js` · shadcn/ui (restyled to tokens) · TanStack Query · `packages/shared-types` · Maps (MapLibre with Google tiles or Google Maps JS). Read `santha-design-system` first; match `design/mockups/landing-page-desktop.png`, `admin-login-desktop.png`, `admin-dashboard-desktop.png`.

## Routes
```
/                      landing (hero, how it works, for stores, for home kitchens, riders, FAQ, footer with legal links)
/stores, /home-kitchens, /riders   merchant & rider acquisition pages with lead forms → POST /v1/leads
/s/[slug]              public store page (SSR, OG tags, deep link to app, "order on Santha" CTA)
/legal/privacy, /legal/terms, /legal/grievance, /legal/fssai
/admin/login           email + password + OTP (ops accounts only)
/admin                 live orders (KPIs, map, needs-attention, table)
/admin/merchants       onboarding queue, detail, approve/pause/offboard, KYC docs, catalogue QA
/admin/riders          roster, status, earnings, actions
/admin/orders/[id]     timeline, comms log, refunds/adjustments (approval limits), reassign
/admin/refunds, /admin/disputes, /admin/payouts (settlement runs, reconciliation exceptions), /admin/micro-markets (polygon editor, fees, hours, COD, versions), /admin/promos, /admin/reports, /admin/audit
```

## Landing rules
- Hero: "The whole town, one app." + Telugu line + 30–45 min promise; primary CTA Marigold "Get it on Android", secondary "iPhone — join waitlist"; phone mockups from `design/mockups/`.
- Use real store-badge artwork only when the apps are live (Google Play / App Store badge guidelines); until then plain buttons.
- SEO: metadata per page, `lang="en"` with `te` alternates, structured data (Organization, MobileApplication), sitemap, OG images from the brand kit. Lighthouse ≥90 performance/accessibility.
- Lead forms post to backend `/v1/leads` with honeypot + rate limit; thank-you state in Telugu and English.

## Admin rules
- Auth: NextAuth (Credentials) against backend `/v1/auth/ops/login` → JWT in httpOnly cookie; OTP second factor; roles admin/ops/finance/support gate routes and actions; session 8 h; audit header `X-Actor-Id` sent on every mutation.
- Layout: left indigo nav (see mockup), top bar with micro-market filter and date; KPI cards; alerts list driven by SLA events (WebSocket `ops:alerts`).
- Tables: server-side pagination/filtering via TanStack Table; CSV export for finance.
- Map: micro-market polygons, order markers coloured by state (indigo preparing, leaf out, chilli breach), rider markers, merchant pins using the mark.
- Destructive or money actions need confirm dialogs and, above thresholds, a second approver (four-eyes) — enforced by backend, reflected in UI.
- Polygon editor: draw/edit, validate non-overlap within a city, versions with effective dates.

## Quality
Playwright e2e for login, approve merchant, reassign order, issue refund, run against the fake backend (`pnpm dev:fake`) so they need no Docker; axe checks; visual regression on landing; `pnpm lint typecheck test` in CI.
