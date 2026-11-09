# ADR-037: Tip after delivery

**Status:** accepted (2026-11-09) · **Context:** ADR-032 added tips at checkout and left "tipping after delivery" for later, because the order is already paid and the wallet holds refund credits only. PRD: "Tip for rider (optional) at checkout and post-delivery; 100% of tip passed to rider".

## Decision

- **Who and when:** the customer of an order that a **Santha rider** delivered, for **24 hours after the delivery**, once the order is delivered. Amounts ₹10 to ₹200 (the app offers ₹10, 20, 30, 50, 100). One paid tip per order. Orders delivered by the store's own staff are not offered it here (their checkout tip already goes to the store, ADR-032).
- **Its own payment, not part of the order:** a tip is a separate row in `tip_payments` with its own provider order, so it never touches the order's bill, state machine, payment intent or refunds. The order's `payment_intents` row and the `payment.captured` event are not involved.
- **Same payment sheet:** `POST /v1/orders/:id/tip` returns the same shape as an order payment, so the apps' payment sheet opens it unchanged; success is confirmed on `POST /v1/tips/:id/confirm` (signature verified, same rules as an order payment, idempotent). The Razorpay webhook also captures a tip, so a tip paid just before the app is closed still counts. In fake and dev mode, `/v1/dev/tips/:id/succeed|fail` play the sheet.
- **Resume, not duplicate:** tapping the same amount again before paying returns the same open payment. A failed attempt leaves the tip open to retry.
- **100% to the rider:** when a tip is captured the rider is told (push, SMS if no push token). The money is **added to the rider's next payout** (`lateTipsPaise`, tips captured in the payout period), shown on the payout statement and in the rider app's payouts list. It is not added to the delivery's pay lines, because that delivery may already be in a closed payout.
- **Reconciliation:** captured tips are included with order payments when checking the aggregator's report, so they never show up as unmatched money.
- **Not refundable in the app.** A mistaken tip is handled by ops outside the app.

## Consequences

- Migration `20261122000000_tip_after_delivery` (`tip_payments`).
- Events: `tip.intent_created`, `tip.captured` (backend); `tip_after_delivery_started`, `tip_after_delivery_paid` (consumer app).
- New error code `TIP_NOT_ALLOWED` (409) with `details.reason`: `not_delivered`, `no_rider`, `window_closed`, `already_tipped`.
- Tests: `test/fake/tip-after-delivery.fake.spec.ts`, the payments repository contract (Prisma and in-memory), `money.spec.ts`, `apps/web/e2e/features/tip-after-delivery.spec.ts`, and the consumer and rider Flutter tests.
