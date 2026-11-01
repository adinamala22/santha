# santha_ui

Design system for the Santha Flutter apps. Source of truth is `design/tokens/` — `lib/src/tokens.dart`
is a verbatim copy of `design/tokens/santha_tokens.dart` (a test fails if they drift).

- `santhaTheme(locale:)` — Material 3 theme; Poppins for English, Noto Sans Telugu for Telugu (bundled, OFL).
- Components: `SanthaButton`, `EtaChip`, `SelfDeliversBadge` (more arrive with the screens that need them).
- Goldens: `test/goldens/*.png`. Generate/refresh with `melos run golden:update` **on Linux** (CI renderer).
