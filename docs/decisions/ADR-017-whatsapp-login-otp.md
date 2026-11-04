# ADR-017: WhatsApp login OTP behind a feature flag, SMS as fallback

- Status: accepted
- Date: 2026-11-03

## Context
Login OTPs (three apps, plus the ops console's second factor) were SMS only (MSG91). A WhatsApp authentication
template through Meta's Cloud API costs roughly half an Indian OTP SMS, needs no DLT template, and most Nellore
users have WhatsApp. Not everyone does, and Meta can fail, so WhatsApp can't be the only channel.

## Decision
- New provider port `WhatsAppOtpProvider` (`infra/providers/whatsapp`) with `mock` and `cloud` (Meta Graph API,
  authentication template with a copy-code button, English and Telugu; retries in English when the Telugu
  translation is missing). Selected by `WHATSAPP_PROVIDER`; fake mode always uses the mock.
- `OtpDeliveryService` (identity-kyc) decides the channel. With the PostHog flag **`whatsapp_otp`** on (default
  **on** since 2026-11-04; switch off with PostHog or `FLAG_OVERRIDES`), it tries WhatsApp, then SMS with the same code. With it off, SMS only. The flag
  is evaluated per device (`device:<id>`) because there is no user before sign-in.
- Production never uses the mock WhatsApp provider, even with the flag on, so defaulting the flag on is safe: until
  `WHATSAPP_PROVIDER=cloud` is configured, production keeps sending SMS.
- The fixed `MOCK_OTP_CODE` applies only when every channel in the plan is a mock, so a live channel never
  carries a guessable code.
- `otp/request` and `ops/login` responses include `channel`. The apps and console say "sent on WhatsApp" (en + te).
  Older apps ignore the field, and older servers' responses read as SMS.
- We call Meta directly, not through a BSP (Gupshup, Interakt), so there is no margin per message. The token is
  a secret in `.env`; the phone number ID and template name are values-file settings.

## Consequences
- OTP cost drops for WhatsApp users, and rollout is per device % or per environment, without a deploy (PostHog).
- If WhatsApp fails, an SMS still goes out, so the SMS provider (MSG91, still a stub) must be live before relying
  on the fallback in prod.
- Delivery receipts (Meta webhooks) are not consumed yet. Failures are seen synchronously from the API response
  only, which covers "not on WhatsApp" but not a message that is accepted and never read.
