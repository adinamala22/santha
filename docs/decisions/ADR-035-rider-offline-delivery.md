# ADR-035: The rider's delivery stays readable without network

**Status:** accepted (2026-11-09) · **Context:** the PRD's non-functional requirements ask for an offline copy of the active job; the rider audit listed it as "later". Riders lose signal in lifts, basements and gated colonies, often exactly at the customer's door.

## Decision

- **What is kept:** the last good answers of `GET /v1/riders/me` (the home, with every delivery in hand) and `GET /v1/jobs/:id`, on the phone in the app's private storage (`santha_rider_jobs`, at most 20 files).
- **When it is used:** only when a call fails because there is **no network**. A refusal from the server (expired session, cancelled job, not found) is shown as it is, never hidden behind old data.
- **What the rider sees:** the home and the job screen open as before, with a banner: "No internet. This is what was saved on this phone 7 min ago. Marking a step needs internet." (English and Telugu). The banner goes as soon as a call succeeds.
- **What does not work offline:** every action (arrived, picked up, delivered, couldn't deliver, going online or offline). They are not queued. A delivered order must be confirmed by the server with the customer's OTP or the door photo, so a queue would risk confirming something the server later refuses. The rider sees the normal "no connection" message and tries again.
- **An offer is never shown from the copy:** it expires in seconds and cannot be answered offline.
- **Privacy:** the copy holds the customer's address and the masked call number only while the delivery is in hand. It is deleted when the delivery leaves the home, when the job is seen as delivered or cancelled, and for everything at sign-out, however the sign-out happened (including an expired session). Nothing is stored if the phone has no usable storage; the app then works online only.
- **Where:** `OfflineRiderApi` in the rider app wraps the API; `RiderApi` gained `homeJson()` and `jobJson()` so the raw answer can be saved; `JsonCache` gained `clear()`.

## Consequences

- No server change and no migration. No analytics event.
- The consumer app keeps using the same `santha_offline` package unchanged apart from `clear()`.
- Tests: `apps/rider/test/offline_job_test.dart` (fallback, flag, refusals, cleanup, no storage, the banner in both languages) and `packages/santha_offline/test/json_cache_test.dart`. There is no web e2e for this change because it is only in the Flutter app; it was checked on the emulator with airplane mode.
