# merchant

Flutter app (flavors dev / stg / prod). Conventions: `.claude/skills/santha-flutter/SKILL.md`.

M0: OTP sign-in (shared flow from `santha_core`, copy from `lib/l10n/app_{en,te}.arb`) → placeholder home.

M5: a live store opens on the Orders home (Orders / Catalogue / Earnings / More): store Open/Paused toggle and the
auto-pause banner, ringing new-order cards with the accept countdown (sound + haptics, realtime socket with polling
fallback), reject reasons, Preparing / Ready / Out / Done tabs, pack-by progress, Mark ready, item unavailable
(remove, or substitute at the same price or less) and today's summary (ADR-011).

```bash
melos run platforms                                   # once, generates android/ios around our flavor files
flutter run --flavor dev -t lib/main_dev.dart         # local backend via http://10.0.2.2:4000
flutter test
```

Android flavor config: `android/app/build.gradle.kts` (application id `app.santha.merchant` + `.dev` / `.stg`).
