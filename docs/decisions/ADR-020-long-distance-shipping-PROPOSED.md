# ADR-020 (PROPOSED): Long-distance shipping by merchants ("Ships across India")

> 2026-11-05: the in-city part ("Deliver anywhere" inside the city, seller-delivered with live tracking) shipped as ADR-022. This ADR now covers only other cities and states, and is still awaiting approval.

- Status: **proposed — needs founder approval before any code**
- Date: 2026-11-04

## Context
Santha's MVP is hyperlocal: 30–45 minute delivery inside a micro-market, by store staff or Santha riders.
Some merchants (sarees, handloom, pickles/podis, home-business crafts) also want to send orders to customers in
other cities and states, delivering themselves or through a courier they choose. This is **not in the PRD P0
list**. It touches serviceability, the order state machine, pricing, GST, payments, settlement and support, so we
should agree the shape before building it.

## Proposal

### Who and what
- **Merchant opt-in** in the partner app: *Ships across India* toggle, behind the PostHog flag
  `long_distance_shipping` (per city). Ops approve the switch (it changes liability), and it is audited.
- **Eligible:** fashion, home businesses and retail items marked *shippable* (non-perishable, below a weight the
  merchant sets). **Never:** cooked food (home kitchens), perishables, medicines (Rx/OTC), items held for review.
  Item-level `shippable` flag, default off; catalogue QA can reject it.
- **Where to:** all Indian pincodes, or only the states the merchant picks. Customers' addresses need a pincode
  (we already store it) and must be complete (no map-only pins).

### Customer experience
- A separate **"Ships to you"** list (and search filter) for stores that ship to the customer's pincode. The
  hyperlocal feed is unchanged, so the 30-minute promise stays clean.
- Store and product pages show *Ships in N days · arrives in X–Y days* (merchant's dispatch time + a transit table
  by zone: same city / same state / rest of India), the shipping fee, and the return policy.
- Cart stays **single-merchant**. A shipped order and a hyperlocal order can't share a cart.

### Money
- **Shipping fee** set by the merchant per zone (same state / other states), optionally free above an amount;
  stored on the quote line like every other fee (integer paise, recomputed from lines).
- **Prepaid only** (UPI/card). No COD for shipped orders (RTO and cash-collection risk).
- **GST:** shipments to another state are inter-state supplies, so tax is **IGST** instead of CGST+SGST. Invoices
  and credit notes must take the place of supply from the delivery address. TCS (section 52) applies as today.
  *Needs the tax advisor's sign-off* (BRD already lists them).
- **Commission:** same commission ladder as self-delivery (the merchant does the delivery), plus a configurable
  `shippingCommissionBps` if we want one. The merchant keeps the shipping fee.
- **Settlement:** payout only after the order is delivered **and** the return window has closed (default 7 days
  after delivery, fashion 7 days for returns), not T+1. Wallet refunds as today.

### Fulfilment and order states
- New fulfilment mode `ship` (alongside `self` and `rider`). New states in the guarded transition function:
  `PLACED → ACCEPTED → PACKED → SHIPPED → DELIVERED`, plus `RETURN_REQUESTED → RETURNED` and
  `SHIPPED → LOST`. Every transition goes through the outbox, like all orders.
- On **SHIPPED**, the merchant enters the courier name and tracking number (AWB) or *own vehicle*, and optionally a
  receipt photo. The customer gets the tracking link (we don't integrate couriers at first; Shiprocket/Delhivery
  APIs can come later behind a provider interface).
- **Delivered:** the customer confirms in the app, or it auto-confirms N days after the expected date unless the
  customer reports a problem. A delivery OTP isn't practical with third-party couriers.
- **Timers:** a *dispatch-by* deadline (auto-cancel + full refund if missed), and an *expected delivery* reminder.

### Recourse and liability
- Lost or damaged in transit: the merchant's liability (they choose the courier). The refund goes to the customer
  first, then is recovered from the merchant's next payout (existing dispute/adjustment flow, 48-hour window).
- Returns: customer ships back (fashion) or merchant arranges a pickup. Refund on the merchant's receipt, or
  auto after X days.
- Issue windows: 48 hours after delivery for damage, the return window for returns.

### Ops and analytics
- Admin: shipped-orders queue (late dispatch, overdue delivery, lost), merchant shipping approval, zone transit
  table per city, CSV export. Events: `order.shipped`, `order.lost`, `order.return_requested`, `order.returned`;
  client `shipping_list_viewed`, `shipment_tracked`.

## Rough size
Backend ≈ 2–3 weeks (states, pricing/GST, settlement hold, timers, endpoints, fake-mode specs), partner app ≈ 1
week (toggle, zones/fees, ship screen with AWB/photo), consumer app ≈ 1–1.5 weeks ("Ships to you", ETA in days,
tracking, confirm delivery, returns), admin ≈ 1 week. Plus tax review.

## Open questions for you
1. Which merchant types are in at launch? Fashion + home business only, or shippable retail too?
2. Any-state, or start with Andhra Pradesh + Telangana (both cheaper and simpler, still IGST for Telangana)?
3. Do we charge commission on the shipping fee?
4. Return window and who pays return shipping?
5. Payout hold length (delivery + 7 days?)
6. Do you want a courier integration (Shiprocket) at launch, or merchant-entered tracking first?

## Alternatives considered
- **Extend micro-market radius to cover other states.** Rejected: breaks the 30–45 minute promise, ETAs, rider
  dispatch and pricing.
- **Santha-managed courier pickup from day one.** More control and better experience, but it means contracts,
  rate cards and a new operations team. Better as phase 2 of this feature.
