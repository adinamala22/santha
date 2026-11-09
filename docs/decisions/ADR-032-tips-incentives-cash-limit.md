# ADR-032: Tips, rider incentives and the cash limit

**Status:** accepted (2026-11-08) · **Context:**
- PRD: "Tip for rider (optional) at checkout and post-delivery; 100% of tip passed to rider";
- PRD rider pay: "+ incentives";
- the rider audit's "later" list.

The product owner chose:
- tips: yes;
- incentives: yes;
- cash limit: off by default, set by ops in the console;
- UPI QR at the door: no.

## Tips

- **Checkout:** the customer can pick a tip (none, ₹10, ₹20, ₹30 or ₹50). `POST /v1/orders` takes `tipPaise` (≤ ₹500). It is added on top of the bill (no fees, GST or commission on it) and stored on the order (`orders.tip_paise`).
- **Who gets it:** 100% goes to whoever delivers.
  - **A Santha rider:** a `tip` line in the job's pay, so it shows in the rider's earnings and payout.
  - **The store's own staff:** credited to the store in the merchant statement (`tipPaise` column), because the store pays its staff.
  - **A 3PL partner** (rare, mocked today): not passed on automatically. Ops settle it by hand.
- **Cash orders:** the tip is part of the cash collected. The rider's payout deducts the cash and adds the tip, so it nets out.
- **Refunds:** a cancellation refunds the whole total, tip included.
- Tipping after delivery is done in ADR-037 (a separate tip payment, 24 hours). Original note: it needs a separate tip payment, because the wallet holds refund credits only and a payment for an order that is already paid would conflict with the order's payment states. It is a follow-up.

## Incentives

- **Settings:** `riderPay.incentives` in the versioned micro-market settings (effective-dated like the rest): up to 6 targets of `{ deliveries, bonusPaise, period: day | week }`, edited in the console's micro-market editor.
- **Rider home:** progress on each target (`done` / `deliveries`, achieved).
- **Payout:** each achieved daily target per IST day, and each achieved weekly target for a whole Mon–Sun week inside the payout period, is added as `incentivesPaise`.
- **Which settings apply:** the rider's first zone, else the first micro-market. Riders work in one city at pilot scale.

## Cash limit

- **Setting:** `riderPay.cashLimitPaise`, `null` by default (no limit), edited in the console's micro-market editor.
- **At the limit:** dispatch skips a rider for a cash order when their cash in hand plus the order's cash would exceed the limit. Prepaid orders still come. The rider app explains why.
- **Cash in hand:** COD collected in the current payout period minus cash deposited.
- **Deposits:** ops record cash a rider hands over on `/admin/riders/:id` (`POST /v1/ops/riders/:id/cash-deposits`, audited as `rider.cash_deposit`). A deposit lowers cash in hand at once, and the payout adds it back, so the cash is not deducted twice.

## Consequences

- Migration `20261119000000_tips_incentives_cash`:
  - `orders.tip_paise`;
  - the `rider_cash_deposits` table.
- Old settings versions have no `cashLimitPaise` or `incentives`; they parse with the defaults (no limit, none).
- Events:
  - `tip_selected`(tip_paise) in the consumer app;
  - the pay line code `tip`;
  - the audit row `rider.cash_deposit`;
  - new payout totals `incentivesPaise` and `depositsPaise`.
