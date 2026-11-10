# ADR-033: Ops see the door evidence of a delivery

**Status:** accepted (2026-11-09) · **Context:** ADR-030 left "show door photos to ops in disputes" as not yet done.

## Decision

- **New endpoint:** `GET /v1/ops/orders/:id/delivery-proof`, for the roles admin, ops and support. It returns:
  - the courier's name and the delivery mode;
  - when the courier reached the door, when the order was delivered, or when the attempt failed;
  - the minutes waited at the door;
  - how the handover was confirmed (`otp` or `photo`) and any cash collected;
  - the door photo as a **link that expires in 5 minutes** (never a public URL).
- **The order page in the console** gets an "At the door" card with these facts and the photo, in English and Telugu. Reloading the page gives a fresh link.
- **Only ops roles** can read it. The customer keeps seeing only their own door photo through tracking (ADR-030).
- **Not audited:** reading is not a mutation, so no `AuditEvent` is written. The short link lifetime limits exposure.

## Consequences

- No migration and no new analytics event.
- Tests: `test/fake/rider-photo-proof.fake.spec.ts` (evidence for photo and OTP handovers, role checks) and `apps/web/e2e/features/rider-photo-proof.spec.ts` (the photo shows on the order page).
