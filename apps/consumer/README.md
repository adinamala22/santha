# consumer

Flutter app (flavors dev / stg / prod). Conventions: `.claude/skills/santha-flutter/SKILL.md`.

- M0: OTP sign-in (shared flow from `santha_core`).
- M3: delivery location (GPS, map pin, saved addresses, serviceability), home (supply-type tabs, promo,
  category grid, stores near you), search (grouped by store, Telugu hints, inline ADD), store page and
  home-kitchen page (slots with cut-offs, food marks, allergens), product sheet, local single-store cart with
  the sticky cart bar, offline cache with a stale banner (ADR-009). Strings: `lib/l10n/app_{en,te}.arb`.
- M4: cart page (per-item "if unavailable" preference), checkout (address, ASAP or kitchen slot, coupon, bill with
  fees and GST, online or cash on delivery), Razorpay checkout (`razorpay_flutter`; a "Test payment" sheet when the
  backend runs the mock gateway), order confirmation, Orders tab and order detail, wallet balance (ADR-010).
- M5: live order detail (realtime order.updated + polling), cancel before the store accepts, store changes to lines
  (removed / substituted) with wallet refunds, WhatsApp order-updates opt-in in Account (ADR-011).
- M6: live tracking on accepted orders: OSM map with store, courier and home, ETA vs the promise, the courier with
  a masked call and the delivery OTP; cancel with a full refund when no courier can be found (ADR-012).

```bash
melos run platforms                                   # once, generates android/ios around our flavor files
pnpm dev:fake                                         # in-memory backend with demo shops (no Docker)
flutter run --flavor dev -t lib/main_dev.dart         # local backend via http://10.0.2.2:4000
flutter test                                          # widget tests run against captured API fixtures
melos run golden:update                               # Linux only: Home golden vs design/mockups/consumer-home-hifi.png
```

Demo: sign in with 9000000001 (code 123456) and pick the saved "Home" address in Dargamitta. Ramesh Stores
(kirana) and Saraswathi's Kitchen (home kitchen) deliver there.

Android flavor config: `android/app/build.gradle.kts` (application id `app.santha.consumer` + `.dev` / `.stg`).
