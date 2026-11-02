# End-to-end walkthrough

This walkthrough runs the whole marketplace on one laptop with no Docker and no live providers. It uses the
fake service (`DATA_STORE=memory`, ADR-005) and OTP `123456`.

## 1. Scripted: the full order and money loop in about 30 seconds
```bash
pnpm i
pnpm dev:fake          # backend :4000 and web :3000
pnpm walkthrough       # in a second terminal
```
`scripts/walkthrough.mjs` narrates 13 steps and exits non-zero if any check fails. CI runs it after the
fake-mode tests (`backend.yml` → fake).

| # | Step | Milestone |
|---|---|---|
| 1 | The store owner, a rider, a customer and ops sign in | M0 |
| 2 | Consent, saved address, serviceability (address inside a micro-market polygon), home feed | M1, M3, M8 |
| 3 | Search "atta" (Telugu hints), cart, server-priced bill in paise, online payment through the mock gateway | M2–M4 |
| 4 | The store accepts for a Santha rider and marks the order ready (guarded transitions and outbox) | M5 |
| 5 | The rider's offer shows the pay → pickup code → delivery OTP | M6 |
| 6 | A cash-on-delivery order delivered by the store's own staff through a staff link | M6 |
| 7 | Rating, plus a missing item auto-refunded to the wallet | M7 |
| 8 | The store replies to the review | M8 |
| 9 | Nightly store settlement: commission, GST (CGST + SGST), TCS and TDS, statement; the store disputes a refund and ops accepts | M7 |
| 10 | Rider weekly payout | M7 |
| 11 | A grievance with its 48 h and 30-day clocks; a DPDP data export | M8 |
| 12 | Ops reports: funnel, on-time, fill rate, contribution per order | M8 |
| 13 | Public store link data for `/s/<slug>` | M8 |

Data is in memory, so restarting `pnpm dev:fake` resets it. Running the script many times without a
restart eventually hits the hourly OTP limit; the script says so and stops.

## 2. By hand, with the apps and the console
1. **Console.**
   - Open http://localhost:3000/admin/login and sign in as `admin@santha.local` / `santha-admin-dev`, OTP `123456`.
   - Finance staff (payouts and refunds only) sign in as `finance@santha.local`.
2. **Consumer app.**
   - Run `melos run dev:consumer` (Android emulator → `10.0.2.2:4000`).
   - Sign in with `9000000001` and pick the Home address. Order from Ramesh Stores and pay with the test payment sheet.
   - Account → Privacy and help: offers consent, download my data, delete account, grievances.
3. **Merchant app.**
   - Run `melos run dev:merchant` and sign in with `9000000201`.
   - The order rings. Accept it with a rider or your own staff, and mark it ready.
   - Earnings shows payouts, refunds and disputes, and customer reviews with Reply.
4. **Rider app.**
   - Run `melos run dev:rider` and sign in with `9000000101`.
   - Go online in Dargamitta, accept the offer, enter the pickup code at the store, then the customer's OTP.
5. **Back in the console.**
   - Live orders: the map and reassign.
   - Payouts: run tonight's settlement, then download the CSV or PDF.
   - Refunds: four-eyes approval above ₹1,000.
   - Disputes, Grievances, Privacy requests, Reviews.
   - Leads: from the `/stores`, `/home-kitchens` and `/riders` pages.
   - Reports.
6. **Time-based features.**
   - Move the clock forward with `curl -X POST localhost:4000/v1/dev/clock -H 'content-type: application/json' -d '{"hours":49}'`.
     The grievance then shows as overdue for acknowledgement, and the 48-hour dispute window closes.

## 3. The website
- Landing page: http://localhost:3000; add `?lang=te` for Telugu.
- Sign-up pages with lead forms: `/stores`, `/home-kitchens`, `/riders`.
- Legal pages (en/te): `/legal/privacy`, `/legal/terms`, `/legal/grievance`, `/legal/fssai`.
- Store link pages, e.g. `/s/ramesh-stores-0201`.
- `sitemap.xml` and `robots.txt`.

## What it does not cover
These need the real stack (`docker compose up -d`) or staging:
- Postgres/PostGIS geometry edge cases, Typesense ranking and BullMQ timers. These are covered by
  `pnpm --filter backend test:int`.
- Real providers (Razorpay, MSG91, Exotel, Digio). They run only on staging, with sandbox keys.
- Performance budgets: `infra/k6/peak.js` against staging (`docs/performance-budgets.md`).
- The beta exit criteria (`docs/launch/beta-plan.md`).
