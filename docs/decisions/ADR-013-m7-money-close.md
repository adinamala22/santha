# ADR-013: M7 settlements, refunds, issues and disputes
2026-11-03 · Status: accepted

## Context
M7 (BUILD-PLAN) closes the money loop. It covers merchant and rider payouts with statements and GST
documents, TCS/TDS, Razorpay Route transfers, reconciliation against the aggregator, a refunds rules
engine with approval limits and four-eyes, issue reporting with windows, disputes, trust scores and
ratings. The PRD and the tech plan leave the formulas, tax rates, rounding, module placement and
which parts run for real in dev open.

## Decision
- **Placement.** Settlement, refunds, reconciliation and disputes live in a `SettlementModule` under
  `payments-settlement/settlement/`. Issues and ratings live in an `IssuesModule` under `trust-safety/`.
  Both are separate Nest modules because they need orders and dispatch, and those already import
  payments and catalogue (whose `TrustSafetyModule` screening stays separate). Refund outcomes reach
  trust-safety through an in-process `onSettled` hook. Outbox events (`refund.issued`,
  `issue.resolved`, `fulfilment.*`) are added when analytics consumes them (M8).
- **Formulas.** These are pure functions in `domain/money.ts`. Each component is rounded once per line
  in integer paise, so totals always equal the sum of the lines.
  - **Merchant net** = items net of store-liable refunds + packaging + delivery-fee credit (self
    delivery only) + self-delivery bonus − commission (6 % self / 9 % rider) − 18 % GST on the
    commission (split equally into CGST and SGST) − GST TCS 0.5 % (s.52) − TDS 0.1 % (s.194-O) − COD
    cash the store's own courier already holds + adjustments.
  - **Adjustments** = −refunds charged to the store in the period (shown as credit-note lines)
    + accepted disputes + a negative balance carried from the previous payout.
  - **Rider net** = delivery pay − COD cash held + carried balance.
  - All rates sit in the versioned fee card (`fees.gstOnCommissionPercent`, `tcsPercent`,
    `tdsPercent`).
  - TCS and TDS are taken on the GST-inclusive item value. Per-HSN taxable values are deferred until
    items carry HSN codes.
- **Runs.** An hourly timer runs after 02:00 IST: stores for the previous IST day, riders on daily
  payouts for that day, and riders on weekly payouts on Mondays for the previous Monday–Sunday week.
  Finance can also run any date by hand. A run is unique per kind and period (DB constraint), so
  re-running is safe.
- **Payouts.** A payout ≤ 0 is put `on_hold` and carried into the next payout. A positive payout is
  sent as a Route transfer to the party's linked account. The account id is a stable mock in dev;
  creating linked accounts during KYC onboarding is the production follow-up. Failed transfers can be
  retried from the console.
- **Statements.** A dependency-free text PDF is stored in object storage. It contains the per-order
  lines, a tax invoice for the commission (SAC 998599, CGST 9 % + SGST 9 %), the TCS/TDS amounts,
  credit notes for refunds charged to the store, dispute credits and the carried balance. A CSV with
  one row per order is served alongside it. Branded, GST-portal-ready invoices come with M8 legal
  review.
- **Refunds.**
  - Decided by `decideRefund`:
    - Missing, wrong, damaged or quality items from customers with trust ≥ 0.6 and claims ≤ ₹300 are
      refunded to the wallet at once, charged to the store.
    - Orders late by more than 15 minutes get a flat ₹20 platform credit.
    - Non-delivery (rider liability, to source), fashion returns (pickup, then refund) and larger or
      low-trust claims go to people.
  - Approval limits: ops users may approve up to ₹2,000; finance and admin have no cap.
  - Four-eyes: refunds above ₹1,000 need two different people. The same person approving twice gets
    `FOUR_EYES_REQUIRED`.
  - Refunds to source use Razorpay; COD orders fall back to the wallet.
  - Every decision is audited.
- **Issue windows.** Customers can report within 2 h for cooked food, 24 h for retail and 48 h for
  fashion (returns are fashion-only). Each problem type can be reported once per order. A claim can
  never exceed what is left on the order.
- **Trust score.** Computed on the fly from 90-, 30- and 7-day history, starting at 0.8. It drops with
  refunds beyond two a month and with rejected issues. Three or more issues in a week raises the
  `frequent_issues` flag; five or more refunds raises `refund_heavy`. Refunds for items the store
  removed while packing do not count against the customer.
- **Disputes.** A store may dispute a refund charged to it within 48 h of it being processed. An
  accepted dispute credits the amount in the next payout and records which payout carried it.
- **Ratings.** One per delivered order, for the store and for the rider when a rider delivered. The
  rider's average updates the score dispatch uses.
- **Reconciliation.** Captured payments for a day are matched to the aggregator report to the paisa.
  Missing, mismatched and unknown entries go to an exceptions queue that ops resolves with a note. With
  no scripted report, the mock gateway's report mirrors what was captured.

## Consequences
Running this for real needs Razorpay Route linked accounts for stores and riders, the settlement
report API on a live account, and CA sign-off on the TCS/TDS treatment and invoice numbering. Return
pickups are recorded but not yet dispatched as reverse fulfilments; ops arranges them by hand until
volume justifies it.
