# ADR-022: 5 km radius, delivery beyond it at an extra charge, and "Deliver anywhere"

Status: accepted (2026-11-05). This ADR covers the in-city phase. Delivery to other cities and states is
still ADR-020, which remains PROPOSED.

## Context
ADR-021 listed every store of the city but greyed out stores whose radius did not reach the customer
("Delivery not available"). The product owner asked for the following:
- **Radius:** 5 km.
- **Beyond the radius:** stores stay open and deliverable inside the city, with a higher delivery charge
  instead of "not deliverable".
- **"Deliver anywhere":** a store option under which the seller delivers to any address and the customer
  tracks the order in the app.

## Decision (the product owner's choices)
1. **Radius.** The default radius is 5 km. On the date of this ADR, every existing store was reset to 5 km
   (migration `20261112000000_radius_5km_deliver_anywhere`; the seed data matches). Ops can still set any
   store from 0.5 to 10 km. That change is audited (ADR-019).
2. **Beyond the radius, same city.** The store still delivers:
   - **Bill:** the normal per-km delivery fee keeps counting, and a flat `beyond_radius` fee line is added.
     The amount comes from the micro-market fee card (`fees.beyondRadiusSurchargePaise`, default ₹30) and
     ops edit it in the area's version editor. Free delivery never waives it. GST on fees applies to it.
   - **Store credit:** when the store delivers itself it is credited this line together with the delivery
     fee, in settlement, the store-credit view and growth reports.
   - **API:** store cards and the store page carry `beyondRadius` (plus `beyondRadiusSurchargePaise` on the
     page) and `deliverable` stays true.
   - **Customer app:** shows "Higher delivery charge" on the card and explains the amount on the store page.
   - **Ordering:** cards are not pushed down, because the ranking score already weighs distance.
   - **Checkout:** `NOT_DELIVERABLE` now means the address is outside every served area, or in another city
     (`notDeliveringReason: other_city`).
3. **Who delivers beyond the radius.** The store's usual choice (self or Santha rider), unless "Deliver
   anywhere" is on.
4. **"Deliver anywhere"** (`merchants.delivers_anywhere`):
   - **Setting:** partners set it in the app (More), on `PATCH /merchants/me` (`deliversAnywhere`). It is
     not offered to fashion stores, which always use riders.
   - **Effect:** customers see "Delivers anywhere". For orders from beyond the radius, the store delivers
     itself. Accept forces `self`, a request for a rider gets `VALIDATION_FAILED`, and the accept sheet
     offers only "deliver myself".
   - **Tracking:** the customer tracks the order live through the existing self-delivery tracking (the staff
     link shares location).
   - **Order flag:** partner orders carry `beyondRadius`.

## Consequences
- Partners need no new step: orders from far away arrive tagged "Beyond your 5 km · extra delivery charge
  added".
- The radius no longer limits who can order. It only sets where the extra charge starts and, with "Deliver
  anywhere", who delivers.
- **Next phase:** long-distance shipping to other cities and states (ADR-020) builds on the same switch once
  its open questions are answered.
