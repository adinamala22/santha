# ADR-041: Manual KYC review and WhatsApp-only login codes for the soft launch

- Status: accepted
- Date: 2026-11-12

## Context
Production refuses the mock KYC and mock OTP providers once live (ADR-024). For the soft launch in Nellore the owner
chose neither Digio (account and contract take days) nor MSG91 (DLT registration takes about a week). About 30
merchants and 10 riders are onboarded by the city ops team in person.

## Decision
- **`KYC_PROVIDER=manual`.** No vendor is called. The caller still checks every number's format. PAN, GSTIN, FSSAI,
  bank account and the Aadhaar step are recorded as typed with `details.manual = true`. The merchant checklist and
  onboarding work as before, and the ops review is the real check: the merchant and rider pages show a notice
  ("typed by the applicant, no authority has checked them: compare with the original document") whenever any check is
  manual. Aadhaar records the masked number only; its code needs to be six digits and nothing else. Digio stays
  available as `KYC_PROVIDER=digio` for later.
- **`OTP_PROVIDER=none`.** No SMS. Login codes (apps and the ops console second factor) go on WhatsApp only. The
  backend refuses to start unless `WHATSAPP_PROVIDER=cloud` in that case. A code that cannot be delivered on WhatsApp
  returns "could not send the code on WhatsApp": there is no fallback. Turning the `whatsapp_otp` flag off would leave
  nobody able to sign in, so it must stay on. MSG91 can be added later by switching to `msg91`.

## Consequences
- A wrong number typed by an applicant is not caught automatically. Ops must compare documents; this is acceptable at
  30 merchants and 10 riders and must be replaced by Digio before scaling.
- Anyone without WhatsApp cannot sign in until SMS exists.
- Mock providers are still refused in production.
