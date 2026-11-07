# ADR-029: Rider onboarding and approval

**Status:** accepted (2026-11-07) · **Context:** rider audit `docs/reviews/2026-11-07-rider-app-audit.md` (B2, B1, B3, B4)

## Problem

Signing in to the rider app gave anyone the `rider` role. They could then go online and receive orders with no identity check, no driving licence, no vehicle details and no bank account. The PRD requires rider onboarding: ID, DL, vehicle and bank, with an online toggle only after that.

## Decision

- **Rider status** on `riders`:
  - `draft` → `submitted` → `approved`, or `rejected` with a reason.
  - Ops can set `suspended` (with a reason) and lift it.
  - Only `approved` riders can:
    - go online (`RIDER_NOT_APPROVED`, 403);
    - accept an offer;
    - appear in dispatch candidates;
    - be picked for an ops reassignment.
- **Existing riders:** the migration backfills every existing rider as `approved`, because they joined before onboarding existed. The seeded demo riders are also approved. New rows start as `draft`.
- **Steps**, run through `identity-kyc` with subject `rider`:
  1. Name and vehicle. Vehicles are bike, scooter, electric or cycle. A number plate is required except for a cycle; it is format-checked, and Bharat-series plates are accepted.
  2. Aadhaar (OTP eKYC) or PAN. Either one, verified.
  3. Driving licence. The number is format-checked, then stored as `pending` for ops to compare with the card. It is not needed for a cycle.
  4. Bank account, verified by penny drop.
- **Submitting** locks the details. A rejection unlocks them and shows the reason in the app.
- **Ops console** (`/admin/riders`):
  - a queue filtered by status, oldest submission first;
  - a detail page with steps and checks; the licence number is shown in full for comparison, other numbers are masked;
  - approve, send back (reason required) and pause (reason required), each confirmed first;
  - every decision is audited (`rider.submitted`, `rider.approved`, `rider.rejected`, `rider.suspended`), and the rider gets a push, or an SMS without the app (`rider.approved` / `rider.rejected` / `rider.suspended`).
- **Pausing** stops new offers at once. A rider with a delivery in hand finishes it; otherwise they are taken offline.

## Fixes shipped together (same audit)

- **B1:** `POST /jobs/:id/delivered` refused any `photoMediaId`, because the id was never checked and skipped the customer's OTP. Riders give the OTP until photo proof ships with an ownership check.
- **B3:** going offline while holding a delivery is refused (`RIDER_HAS_ACTIVE_JOB`, 409). Otherwise the customer's live tracking would stop.
- **B4:** in the app, sign-out goes offline first, and is refused while a delivery is in hand.

## Consequences

- Migration `20261116000000_rider_onboarding` adds:
  - the `riders` columns `status`, `vehicle_number`, `status_note`, `submitted_at`, `decided_at` and `decided_by`;
  - the KYC kind `driving_licence`.
- A selfie and photos of the licence card arrive with the rider photo upload (the next PR), together with photo proof of delivery.
- Settlement still pays every rider who delivered, whatever their status (a paused rider is still owed money).
