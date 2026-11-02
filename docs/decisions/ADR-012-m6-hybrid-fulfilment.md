# ADR-012: M6 hybrid fulfilment, dispatch and tracking
2026-11-07 · Status: accepted

## Context
M6 (BUILD-PLAN) delivers orders two ways: by the store's own staff or by Santha riders, with a fallback
ladder and live tracking. The architecture skill and the dispatch-flow diagram set the shape (30-s
offers, batching of up to 2 orders with ≤ 6 min impact, fallback after 5 min, Redis GEO). Several
details are not specified: when the rider search starts, how scoring weights work, how staff deliver
without an app, how money for each mode shows before settlement, and which providers are real.

## Decision
- **Start at accept.** The fulfilment choice travels with `order.accepted` (`fulfilment_mode`,
  `staff_id`). dispatch-tracking consumes that event, so orders never imports dispatch. For riders, the
  search starts at accept, not at ready, so the rider arrives around the time the order is packed. Fashion is
  always `rider`. The promise is set as pack-by + straight-line travel at 18 km/h + `sla.etaBufferMin`.
- **Scoring.** This is a pure function: distance to the store (10 per km), current load (8 per job), rating
  above 4 (−4 per star) and acceptance rate (−6 × rate). Riders more than 5 km away, offline, outside their
  chosen zones, already holding an open offer, or carrying 2 jobs are skipped. A second job is offered only
  when the rider's first job is not yet picked up and the detour is ≤ 6 min (`batchEligible`). Ties break
  on rider id, so results are deterministic. The weights are code constants until we have data to tune them.
- **Offers.** Each offer lasts 30 s and is a `dispatch.offer_expired` timer keyed `fulfilment:{id}:offer`.
  When an offer is declined or expires, it goes to the next-best rider that has not been tried. When
  nobody fits, the search retries every 30 s. The offer shows pay with a breakdown (base + distance + batch
  bonus) and only the drop *area*. The rider sees the exact address after accepting (privacy rule).
- **Fallback ladder.** It starts at `sla.riderFallbackMin` (5 min). Each later step follows 2 min after the
  previous one: 3PL (provider interface; the only implementation is a mock with capacity set by
  `MOCK_3PL_AVAILABLE`), then a ₹20 self-delivery bonus offered to the store (the store can switch with
  "Deliver myself"), then the standby pool (12 km radius, zones ignored), then the customer is told with a
  new estimate and may cancel for a full refund. That cancel uses a `system` edge PREPARING/READY →
  CANCELLED. The search keeps running throughout.
- **Self delivery without an app.** A staff member gets an SMS with a tokenised link, `/d/{token}` (Next.js,
  public, no account). The page handles pickup (once the order is READY), shares live location from the
  browser while the job is active, and takes the customer's OTP and the cash collected. If the owner
  delivers, the same link is shown in the merchant app. Riders, and not staff, must enter the store's
  pickup code. A *staff mode* inside the merchant app is deferred: the link covers the flow on any phone.
- **Proof.** Delivery needs the customer's 4-digit OTP. The API also accepts a door photo
  (`photoMediaId`), but the photo capture UI for riders comes with the media flow for riders (M8).
  COD orders record the cash collected.
- **Live location.** Rider positions live in a Redis GEO set with a last-seen hash and are fresh for 120 s.
  They are never stored in Postgres. Fulfilments keep only the last fix while the delivery is active.
  Every fix goes to the customer's socket as `order.location` with a recomputed ETA. When the ETA slips
  more than 5 min past the promise, the customer is told once. The tracking API stops returning a
  location after delivery. The rider app sends a position every 10 s while it is open. A background
  location service is M8 hardening.
- **Money before settlement.** The commission ladder lives in the fee card
  (`fees.commissionSelfPercent` 6, `fees.commissionRiderPercent` 9). The merchant *statement preview*
  computes per delivered order: items − commission + delivery-fee credit (self only, the quoted delivery
  fee) + self-delivery bonus. Rider pay is deterministic: base + per-km on (rider → store + store → drop)
  + paid waiting after 5 min at the store + batch bonus. The final statements, payouts and GST documents
  are M7.
- **Masked calls.** Every call button uses a proxy number from `CallMaskingProvider` (Exotel later; the
  mock returns a stable fake number per order and party). Real numbers are never shown.
- **Events.** Order events (`order.picked_up`, `order.out_for_delivery`, `order.delivered`) go through the
  guarded transition and the outbox as before. The dispatch steps themselves (`fulfilment.*`) are
  socket and notification signals only for now. They become outbox domain events in M7, when settlement
  starts consuming them.

## Consequences
On staging, the ≤ 2 s marker update needs the Socket.IO path through the load balancer, plus real
devices. In fake mode, `test/fake/m6-dispatch.fake.spec.ts` measures it at the socket. Road distances
(Routes API) can replace straight-line distance inside `travelMin` without API changes. Scheduled
kitchen slots still use the ASAP search at accept time; pre-booking riders per slot from a forecast
comes when slot volume justifies it.
