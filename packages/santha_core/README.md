# santha_core

Shared app plumbing for consumer, merchant and rider:

- `AppConfig` / `Flavor` — per-flavor API base URL (`--dart-define=API_BASE_URL=…` overrides dev).
- `KeyValueStore` — `flutter_secure_storage` in apps, in-memory in tests.
- Device id — random per-install UUID kept in secure storage; sent as `X-Device-Id` (tokens are device-bound).
- `authControllerProvider` — restore → OTP request/verify → signed in → sign out / session expiry.
- `OtpLoginScreen` — the two-step phone + code screen built from santha_ui; each app passes its
  own localised `OtpLoginStrings` (en + te from the app's ARB files).

Analytics (PostHog), flags, connectivity and formatting helpers land with the features that use them.
