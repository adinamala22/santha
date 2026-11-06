# ADR-027: Push notifications in the apps

Status: accepted (2026-11-05)

## Context
The backend has sent FCM pushes since M5 (urgent merchant "new order" and rider "new offer"), but no app ever registered a token (review G1). Alerts only worked while the app was open. A store with its phone locked missed new orders, the accept window ran out and the store was auto-paused. Riders missed offers, and customers heard nothing unless they opted in to WhatsApp.

## Decision
- **Firebase settings come from the build**, not from `google-services.json`:
  - The apps start Firebase with options passed as `--dart-define=FIREBASE_PROJECT_ID / SENDER_ID / API_KEY / APP_ID`.
  - `apps-release.yml` takes them from `apps.firebase` in the values file, with a different app id per app.
  - Nothing Firebase-specific is committed. The Google Services Gradle plugin is not used.
  - Builds without these settings (local dev, tests) run without push (`NoPush`).
- **Registration (`santha_core`):**
  - After sign-in, the app asks for notification permission (Android 13+), gets the FCM registration token and sends it with `PUT /v1/me/push-token`. It does the same whenever FCM rotates the token.
  - **Before sign-out** it calls the new `DELETE /v1/me/push-token`, so a shared phone stops getting the previous person's notifications.
  - Tokens stay keyed by device, so a new person signing in on the phone takes the token over.
- **Channels (Android, created in `MainActivity`):**
  - `updates` (default) for everything.
  - `orders_alarm` (high importance, vibration) for urgent pushes. The merchant and rider apps play the Santha chime (`res/raw/order_alert.wav`, an original synthesised tone), which matches what the backend already sends (`channel_id: orders_alarm`, `sound: order_alert`).
  - Channel names are in en and te. The status-bar icon is a white shopping bag tinted Santha Indigo.
- **Taps:** the consumer app opens the order (`data.orderId`). The merchant and rider apps open their home, which lists the new order or offer. The event is tracked as `push_opened`.
- **Token type:** the apps send FCM **registration tokens** (`getToken`), which the backend's HTTP v1 sender uses as `message.token`. firebase_messaging 17 deprecates these in favour of installation-ID sends; the apps and the backend have to move to that together.

## Setup (once per environment)
1. Create a Firebase project and add three Android apps:
   - `app.santha.consumer`, `app.santha.merchant` and `app.santha.rider`;
   - plus their `.stg` ids for QA, if they differ by flavor.
2. Put the project id, sender id, Web API key and the three app ids in `config/values/<env>.values.yaml` under `apps.firebase`.
3. On the server, set `PUSH_PROVIDER=fcm` and `FCM_SERVICE_ACCOUNT_B64` (base64 of a service-account JSON with the Firebase Cloud Messaging role) in the stack's `.env`.
4. iOS is later: it needs an APNs key in Firebase and the Push capability.

## Consequences
- Release builds without `apps.firebase` still work, but have no push. The release workflow warns.
- In fake/dev mode, pushes are recorded by the mock provider, and the ops order page shows them in the comms log.
