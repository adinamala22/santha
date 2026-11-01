# ADR-006: M1 scope choices — KYC model, store photos, field-agent onboarding, client analytics
2026-11-01 · Status: accepted

## Context
M1 (BUILD-PLAN) covers micro-markets, merchant onboarding, KYC and ops approval. A few things the PRD mentions
next to onboarding are not in M1's acceptance checks and need infrastructure that lands later.

## Decision
- **KYC lives in identity-kyc** as one `kyc_checks` table keyed by (subject type, subject id, kind), behind a
  `KycProvider` port (mock now, Digio/Signzy at launch). Merchants use it in M1; riders reuse it in M6. PAN,
  Aadhaar and bank account numbers are stored masked only; GSTIN, FSSAI and drug-licence numbers are public
  business identifiers and are stored in full. A failed check is stored with a human reason (not an error) so the
  app can show it. Drug licences are captured for pharmacies and reviewed by ops (no provider check).
- **Food sellers** are every home kitchen plus any merchant with `sells_food`; FSSAI must be verified to submit,
  is re-checked at approval, and again at go-live.
- **Store photos move to M2**, together with catalogue images, because both need the image upload pipeline
  (S3 presigned uploads, CDN variants, moderation). Ops review in M1 is on KYC results and store details.
- **Field-agent (assisted) onboarding moves to M2** with assisted catalogue building; in M1 merchants self-onboard
  in the merchant app and ops review in the console.
- **Client analytics**: the onboarding screens are instrumented through a thin `Analytics` interface in
  santha_core that logs in dev; the PostHog SDK is attached when the PostHog project exists (M3, with the first
  consumer funnel), so event names are fixed now and listed in `docs/events.md`.
- **Serviceability has no cache** in front of it in M1, so micro-market edits apply on the next request (the
  acceptance bound is 60 s). A Redis cache keyed by config version can be added when traffic needs it.

## Consequences / when to revisit
M2 must add store photos to the onboarding checklist and the ops review screen. Revisit the no-cache decision when
`/serviceability` p95 exceeds 50 ms.
