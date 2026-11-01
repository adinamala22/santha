# rider

Flutter app (flavors dev / stg / prod). Conventions: `.claude/skills/santha-flutter/SKILL.md`.

M0: OTP sign-in (shared flow from `santha_core`, copy from `lib/l10n/app_{en,te}.arb`) → placeholder home.

```bash
melos run platforms                                   # once, generates android/ios around our flavor files
flutter run --flavor dev -t lib/main_dev.dart         # local backend via http://10.0.2.2:4000
flutter test
```

Android flavor config: `android/app/build.gradle.kts` (application id `app.santha.rider` + `.dev` / `.stg`).
