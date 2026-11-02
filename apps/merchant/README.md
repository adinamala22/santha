# merchant

Flutter app (flavors dev / stg / prod). Conventions: `.claude/skills/santha-flutter/SKILL.md`.

M0: OTP sign-in (shared flow from `santha_core`, copy from `lib/l10n/app_{en,te}.arb`) → placeholder home.

M5: a live store opens on the Orders home (Orders / Catalogue / Earnings / More): store Open/Paused toggle and the
auto-pause banner, ringing new-order cards with the accept countdown (sound + haptics, realtime socket with polling
fallback), reject reasons, Preparing / Ready / Out / Done tabs, pack-by progress, Mark ready, item unavailable
(remove, or substitute at the same price or less) and today's summary (ADR-011).

M6: Accept asks how the order reaches the customer: deliver myself (a staff member gets the tracking link by SMS,
or the owner delivers) or request a Santha rider; order cards show the pickup code, the courier, the staff link
and the no-rider bonus with "Deliver myself"; Earnings shows today's statement preview (ADR-012).

M7: Earnings lists nightly payouts with the commission, GST, TCS and TDS lines, and refunds charged to the store
with a 48-hour dispute (ADR-013).

```bash
melos run platforms                                   # once, generates android/ios around our flavor files
flutter run --flavor dev -t lib/main_dev.dart         # local backend via http://10.0.2.2:4000
flutter test
```

Android flavor config: `android/app/build.gradle.kts` (application id `app.santha.merchant` + `.dev` / `.stg`).
