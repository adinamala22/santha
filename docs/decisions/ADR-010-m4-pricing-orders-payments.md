# ADR-010: M4 pricing, order placement and payments
2026-11-05 · Status: accepted

## Context
M4 (BUILD-PLAN) adds carts, the bill (computeQuote), promos with budgets, POST /orders with an
Idempotency-Key, COD rules and online payments through Razorpay. The PRD/tech plan leave the tax model,
the pre-payment order states, the cart's home and several money edge cases open.

## Decision
- **Tax model.** Item prices are GST-inclusive (MRP rules), so items carry no extra tax line. The
  platform's own fees (delivery, platform, small-order) carry GST at `fees.gstOnFeesPercent` (18%).
  Cooked food from home kitchens is taxed at `fees.gstCookedFoodPercent` (5%) on food + packaging after
  discount, collected by Santha as e-commerce operator (CGST s.9(5)). Both rates live in the versioned
  micro-market fee card (defaults keep older versions parsing). HSN-level invoices come with M7.
- **Fees.** Delivery = base + per-km on the straight-line distance (rounded to the paisa), free at or
  above `freeDeliveryAbovePaise`; small-order fee below its threshold; flat platform fee; packaging is a
  per-merchant charge (new `merchants.packaging_fee_paise`) capped by `packagingFeeCapPaise`. The
  store's MOV blocks placing (problem `MIN_ORDER_NOT_MET`). Road distance can replace straight-line later
  without changing the API.
- **Server cart, one store.** `PUT /v1/cart` replaces the cart (the app keeps its local cart and syncs
  at checkout). Another store's items need `replace: true` (`CART_CONFLICT` otherwise); multi-store
  carts stay Phase 2. Each line carries a substitution preference (call me / similar / remove).
- **Quotes are the bill of record.** `POST /v1/cart/price` computes the bill plus every placement check
  (delivery area + radius, store hours, kitchen slot cut-off/capacity/menu day/portions, COD
  eligibility) and saves a quote (`QUOTE_TTL_MIN`, 30). `POST /v1/orders` re-prices it: if the total
  moved the customer gets `QUOTE_CHANGED` with a fresh quote — prices are never changed silently.
- **Pre-lifecycle states.** Online orders start in `AWAITING_PAYMENT` and become `PLACED` only when the
  payment is captured; `PAYMENT_FAILED` when the customer gives up or `PAYMENT_WINDOW_MIN` (15) passes
  (repeatable job). COD orders are `PLACED` at once. These states go through the same guarded
  `transition()` (CAS on the state, history row, outbox event) as the lifecycle.
- **COD rules.** COD needs the micro-market's COD config and the `cod_payments` flag, an allowed supply
  type (retail/fashion; never home kitchens = cooked food), total ≤ `cod.maxOrderPaise` (₹1,500), and
  fewer than two live COD orders per customer — the MVP "COD trust" rule until M7's trust scores.
- **Promo budgets.** Budget is reserved with a SQL compare-and-swap (`spent + discount ≤ budget`) when
  the order is created, released on `order.payment_failed`/`cancelled`/`rejected`/`expired`, confirmed on
  `order.placed`. A discount never partially fits a budget: when it doesn't, the code is exhausted at
  once (the M4 "disabled within 1 min" check is met immediately). Concurrent redemptions are tested
  against Postgres.
- **Idempotency.** `IdempotencyService` (Redis `SET NX`, in-process in fake mode) stores the first
  response 24 h per (scope, user, key); a concurrent duplicate gets 409, a different body 422. The order
  row also has a unique (user, key) as a durable backstop.
- **Payments.** `PaymentsProvider` port: Razorpay (test-mode keys = sandbox, live keys = production; the
  app uses Razorpay Standard Checkout) and a mock that signs exactly like Razorpay so dev builds and tests
  run the same verification code. Checkout success is confirmed with the HMAC signature; webhooks are
  verified on the raw body, stored once per provider event id, and processed idempotently. A capture
  that arrives after the order lapsed is recorded and credited to the wallet (refunds to source are M7).
  Production refuses `mock` and `razorpay_sandbox`.
- **Wallet** holds refund credits only (ledger, balance = sum); spending it at checkout is a post-launch
  item in BUILD-PLAN.
- **Not yet:** monthly partitioning of `orders` (deferred until volume; it complicates FKs), road-distance
  delivery fees, Cashfree as alternate gateway.

## Consequences / when to revisit
The bill can always be explained from the stored quote, fee card version and lines. Slot capacity is
counted from orders that hold a slot (live + awaiting payment), so an abandoned payment holds a slot for at
most the payment window. Revisit the COD trust rule when M7 adds trust scores, and the tax lines when GST
invoices (M7) need HSN codes.
