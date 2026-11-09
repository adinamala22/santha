# Rider app audit (2026-11-07)

Scope:
- the rider app (`apps/rider`);
- the backend it calls (`dispatch-tracking`, `identity-kyc`);
- the PRD's rider requirements (§ Rider, FR pay model, fraud controls).

It is compared with what quick-commerce delivery-partner apps commonly offer, such as the Blinkit and Zepto partner apps. The comparison covers features only. Santha keeps its own model: real shops, not dark stores, so riders go to many stores rather than one hub.

## 1. Bugs found

| # | Severity | Bug | Fix |
|---|---|---|---|
| B1 | **Critical (fraud)** | `POST /v1/jobs/:id/delivered` accepts any UUID as `photoMediaId` in place of the customer's OTP. The photo is never checked, and riders cannot upload photos at all. A rider can mark an order delivered without the customer's code. | A photo is accepted only if it is an uploaded delivery photo that belongs to this rider and this job. Until photo proof ships, riders must give the OTP. |
| B2 | **Critical (safety and compliance)** | Signing in to the rider app gives anyone the rider role. They can go online and receive orders with no ID, driving licence, vehicle or bank details, and no ops approval. The PRD requires rider onboarding. | Rider onboarding (ADR-029). Riders are `draft → submitted → approved / rejected`, and ops can suspend. Only approved riders can go online, accept offers or appear in dispatch. |
| B3 | High | A rider can go offline in the middle of a delivery. The server drops their position, so the customer's live tracking stops and the background location stream ends. | Going offline is refused while a job is active: `RIDER_HAS_ACTIVE_JOB` on the server, and a message in the app. |
| B4 | Medium | Signing out while online leaves the rider `online` on the server, so their online minutes keep counting. With an active job, signing out abandons it silently. | Sign-out goes offline first. It is blocked, with a message, while a job is active. |
| B5 | Medium | The cash-collected field turns "1,200" or "abc" into ₹0 and sends it, which records a cash shortage. | Commas and spaces are accepted. An amount that can't be read shows an error and nothing is sent. |
| B6 | Low | Tapping **Arrived at store** clears a pickup code the rider has already typed. | The code is cleared only after pickup and delivery. |
| B7 | Low | If the job screen fails to load, it shows an error with no way to retry. | A Retry button. |
| B8 | Low | The analytics events `offer_shown`, `arrived_store` and `earnings_viewed`, listed in `docs/events.md` and the PRD, are never sent. | Now sent. |

## 2. Feature comparison

✅ = Santha has it · 🟡 = partial · ❌ = missing. "Plan" says where it lands.

| Feature (common in partner apps) | Santha | Plan |
|---|---|---|
| Onboarding: documents (Aadhaar or PAN, driving licence, vehicle RC), bank, selfie; approval | ❌ | **This PR**: Aadhaar or PAN, DL, vehicle and number, bank (penny drop); ops approve. A selfie or photo is part of the photo work. |
| Online/offline with zone choice | ✅ | — |
| Offer card: pay, pickup and drop distance, countdown | ✅ | — |
| Pay breakdown before accepting | ✅ (base, distance, wait, batch) | Peak/rain multipliers are a backend pay table item. |
| Batching (2 orders) | ✅ backend | — |
| Navigation hand-off to Google Maps | ✅ | — |
| Arrived at store, wait pay | ✅ | — |
| Pickup verification (order code) | ✅ | — |
| Delivery OTP | ✅ | — |
| Photo proof at the door (no-contact) | 🟡 backend only, and unsafe (B1) | Next PR: rider photo upload. |
| Arrived at customer, waiting timer | ❌ | Next PR. |
| Couldn't deliver (reasons, retry) | ✅ | — |
| Masked call to customer | ✅ (number from server) | — |
| COD: cash collected | ✅ | Validation fixed (B5). |
| COD: cash in hand and its limit | 🟡 deducted in payouts only | **This PR**: "Cash with you" on the home screen. A limit that blocks offers is a later item (needs an ops setting). |
| UPI QR at the door for COD | ❌ | Later (PRD: UPI-on-delivery; needs Razorpay QR). |
| Earnings today, per-order breakdown | ✅ | — |
| Earnings history (week), payouts | 🟡 payouts only | Next PR: last 7 days. |
| Incentives and milestones ("10 orders → ₹150") | ❌ | Later (needs an incentive table and ops config). |
| Performance: rating, acceptance rate | 🟡 rating only | **This PR**: acceptance rate on the home screen. |
| Tips from customers | ❌ | Later (consumer checkout feature; PRD P0, 100% to the rider). |
| SOS / emergency | ❌ | Next PR: call 112 and alert ops. |
| Support chat | ✅ (ADR-028) | — |
| Push for new offers | ✅ (ADR-027) | — |
| Background location while online | ✅ (ADR-026) | — |
| Profile: documents, bank, vehicle | ❌ | **This PR**: onboarding doubles as the profile view. |
| Offline cache of the active job | ❌ | Later (PRD NFR). |
| Demand heatmap, referral, shift booking | ❌ | Not MVP. |

## 3. What this PR delivers

1. **B1–B8** fixed, with tests.
2. **Rider onboarding (ADR-029):**
   - Steps: name and vehicle → Aadhaar (OTP) or PAN → driving licence → vehicle number → bank.
   - Submit, then a waiting screen; rejected riders see the reason.
   - Ops get a **Riders** page in the console: queue, details, approve, reject with reason, suspend. Every action is audited.
   - Seeded demo riders start approved.
3. **Home:** cash with you (COD collected but not yet settled) and acceptance rate.

## 4. Next PRs (in order)

1. **Photo proof of delivery**: rider photo upload, used for no-contact delivery and as evidence in disputes. Also arrived at the customer, with a waiting timer.
2. **SOS**: a button on the job screen that calls 112 and raises an ops alert with the rider's position.
3. **Earnings history**: last 7 days, and per-order details for past days.
4. **Later (needs business decisions):**
   - tips at checkout;
   - incentives and milestones;
   - cash-in-hand limit;
   - UPI QR for COD;
   - offline job cache.

## Status

- B1–B8 fixed, and rider onboarding with ops approval (ADR-029) built, in the PR `feat/rider-onboarding-and-fixes`. Tests:
  - backend: `test/fake/rider-onboarding.fake.spec.ts`, plus checks added to the m6 and failed-delivery tests, the repository contract and the KYC format tests;
  - rider app: `test/rider_audit_test.dart`;
  - e2e: `apps/web/e2e/features/rider-onboarding.spec.ts`.
- Home: cash with you and acceptance rate.
- Next step 1 is done (ADR-030), in the PR `feat/rider-photo-proof`:
  - photo proof of delivery;
  - rider selfie and licence-card uploads;
  - arrived at the customer, with a waiting timer.
- Next steps 2 and 3 are done (ADR-031), in the PR `feat/rider-sos-earnings`:
  - SOS, with 112 and the ops live board;
  - earnings for the last 7 days.
- Tips at checkout, incentives, and a cash limit set by ops (off by default) are done (ADR-032), in the PR `feat/rider-tips-incentives`.
- UPI QR at the door: not wanted.
- Still open:
  - tipping after delivery (needs a separate tip payment).
- The offline job cache is done (ADR-035), in the PR `feat/rider-offline-job`.
