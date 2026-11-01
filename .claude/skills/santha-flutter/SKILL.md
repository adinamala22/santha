---
name: santha-flutter
description: How to build the Santha Flutter apps (consumer, merchant, rider) — melos monorepo, feature-first structure, Riverpod + go_router + Dio conventions, santha_ui theme and components, en/te localisation, offline queue (Drift), maps and background location, FCM ringing alerts, flavors, testing and release. Use for any task under apps/consumer, apps/merchant, apps/rider or packages/santha_*.
---

# Santha Flutter apps

Flutter 3.x · Dart 3 · melos monorepo. Read `santha-design-system` and `santha-architecture` first; open the matching mockup/wireframe in `design/mockups/` and `docs/wireframes/`.

## Packages
- `santha_ui` — theme from tokens, components (StoreCard, EtaChip, SelfDeliversBadge, ProductTile, NewOrderCard, FulfilmentChoice, StickyCartBar, VegMark, SlotChip, SanthaAppBar, BottomTabs), icons, logo widgets. Golden tests for every component.
- `santha_api` — generated client from `apps/backend/openapi.json` (openapi_generator or dio-based codegen), interceptors (auth refresh, retry with jitter, Idempotency-Key for POST /orders), Socket.IO client with room helpers.
- `santha_core` — auth/session (flutter_secure_storage), analytics (PostHog), flags, logging, connectivity, result/error types, localisation helpers (`context.l10n`), formatting (₹, Telugu numerals off).
- `santha_offline` — Drift DB + sync queue + conflict rules (server wins on order state; client wins on stock toggles ≤2 min).
- `santha_maps` — map widget abstraction (Google Maps SDK), polyline + rider marker, geocoding, ETA display.

## App structure (each app)
```
lib/
  main_{dev,stg,prod}.dart  app.dart (router, theme, l10n)  flavors.dart
  features/<feature>/{data,domain,presentation}/   (repositories, models (freezed), providers (Riverpod), screens, widgets)
  l10n/app_en.arb app_te.arb
```
Consumer features: location, home, search, store, product, cart, checkout, orders, tracking, account, support.
Merchant features: onboarding, catalogue, availability, orders, fulfilment (+ staff mode), staff, earnings, performance.
Rider features: onboarding, shift, offers, job, proof, earnings.

## Rules
- Riverpod (`AsyncNotifier`) for state; no global singletons except via providers. Optimistic cart updates, server-validated at checkout.
- go_router typed routes; deep links `santha.app/s/{slug}` (store) and `santha.app/o/{id}` (tracking) + App/Universal Links.
- Every screen handles loading, empty, error and offline; errors are human and in both languages.
- Images via CDN variants (≤40 KB WebP thumbnails); use `cached_network_image`; lists virtualised; avoid rebuilding whole lists on cart change.
- Localisation: every string in `app_en.arb` and `app_te.arb`; fallback font for Telugu; test at 130% text scale.
- Accessibility: Semantics labels on tappables; ≥44 px targets; contrast per tokens.
- Merchant ringing alert: FCM data message → full-screen intent (Android) with looping sound until acted or 20 s; voice-call fallback handled server-side. Request battery-optimisation exemption during onboarding.
- Rider location: foreground service while on a job; 5 s pings via WebSocket; stop at delivery.
- Barcode scan: `mobile_scanner`; camera permission rationale in Telugu/English.
- Secrets: none in code; per-flavor Firebase config; API host per flavor; certificate pinning in prod.
- Analytics: emit events listed in `docs/events.md` (client section) with `micro_market_id`.

## Testing & release
Unit (domain), widget (screens with fake repos), device testing against the fake backend (`pnpm dev:fake`, demo users, OTP 123456; each milestone's new screens must work end to end against it), golden (santha_ui), integration (Patrol) for: place order, merchant accept + self-deliver, rider accept + deliver. CI: `melos run analyze test`, Firebase Test Lab on a low-end device profile. Release via fastlane lanes `beta` (internal/TestFlight) and `release` (staged rollout 10/50/100).
