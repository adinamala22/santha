# ADR-030: Rider photos, door-photo proof, and "arrived at the customer"

**Status:** accepted (2026-11-07) · **Context:**
- rider audit `docs/reviews/2026-11-07-rider-app-audit.md`, next step 1;
- PRD: "proof of delivery (photo/OTP)";
- ADR-029 (rider onboarding).

## Decision

- **Private rider photos** (`rider_photos`). Kinds:
  - `selfie` and `licence` (the driving licence card), at sign-up;
  - `delivery`, a photo at the customer's door.
- **Upload:** the same presigned flow as merchant media (request, PUT, complete). The server decodes the image, rotates it upright, strips metadata, shrinks it to at most 1280 px and stores WebP.
- **Never public:**
  - photos live under `private/` and are served only through short-lived (5 min) signed links;
  - S3 presigned GET in AWS; fake mode uses a signed `/v1/dev/private` route;
  - the public media route refuses `private/` and `originals/` keys;
  - ops see sign-up photos on `/admin/riders/:id`;
  - a door photo is shown only to that order's customer, through tracking `proofPhotoUrl`.
- **Sign-up** (ADR-029) gains a `selfie` step, and the `driving_licence` step now needs the number and a photo of the card (a cycle needs neither). Sign-up photos can change only while details are editable (draft or rejected).
- **Arrived at the customer:**
  - `POST /v1/jobs/:id/arrived-drop` sets `arrivedDropAt`;
  - the customer gets `customer.courier_arrived` (push, SMS fallback) and a live `order.updated`;
  - the rider app shows a waiting timer, and after 5 minutes a prompt to call again or report "Couldn't deliver" (ADR-026).
- **Door photo instead of the OTP** is allowed only when all of these hold:
  1. the order is prepaid (cash orders always need the OTP);
  2. the total is ≤ ₹2,000 (`PHOTO_PROOF_MAX_PAISE`);
  3. the rider marked "arrived at the customer";
  4. the photo is this rider's `delivery` photo for this job, and processed.

  Anything else is refused. This closes the B1 hole for good.
- Staff self-delivery (the `/d/` link) keeps the OTP only.

## Consequences

- Migration `20261117000000_rider_photos`:
  - the `rider_photos` table;
  - `fulfilments.arrived_drop_at`.
- New events:
  - rider app: `arrived_customer`, and `delivered(verification: photo)`;
  - template: `customer.courier_arrived`.
- Riders already in review need a selfie, and a licence photo unless they ride a cycle, before ops can approve them. Approved riders are not affected.
- Not yet: a customer setting for "always leave at the door" (today the rider decides with the customer on a call), and showing door photos to ops in disputes (they can be fetched from the order's tracking).
