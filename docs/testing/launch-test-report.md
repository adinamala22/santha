# Launch test report (12 November 2026)

What was tested, how, with whom, and what we found. How the tests are run is in
[launch-test-method.md](launch-test-method.md). Everything below ran against **QA**
(`https://api.test.santhaapp.com`, `https://test.santhaapp.com`) running the code of `main` after pull requests #37 to #48,
unless it says "fake" (the in-memory backend).

## Summary
| Area | Scenarios | Result |
|---|---|---|
| API edge cases and several users at once (`launch-campaign.spec.ts`, LC-nn) | 18 | **QA: 16 pass, 2 skipped by design. Fake: 18 pass** |
| Public website (English, Telugu, phone width) | 12 pages | 11 fine, **1 bug found** (`/stores` scrolls sideways on a phone), fixed in PR #50 |
| Ops console (`launch-screenshots.spec.ts`) | 17 sections + order page + Telugu + refusals | **All pass**; sign-in with the one-time code works |
| Apps on the emulator (consumer A and B, store owner, rider) | 1 full order, 2 customers | **Pass**; **1 layout bug found** (rider delivery screen), fixed in PR #51 |
| Existing suites, run earlier the same day on the combined code | backend unit 238, backend fake 191, consumer 58, rider 50 | All pass (CI re-runs them on every pull request) |

### Findings
| # | Found by | What | Status |
|---|---|---|---|
| F1 | LC specs on QA | The ops sign-in in the live e2e suite failed at "One-time code": the console allows 10 sign-ins per email per hour and the suite signed in once per spec, so QA answered **429 "Too many attempts"** | Fixed in #50 (sign in once per run, reuse the session) |
| F2 | Phone screenshots | `/stores` scrolled sideways by 53 px on a phone (a grid item without `min-w-0`) | Fixed in #50, and the spec now fails if any page scrolls sideways |
| F3 | Deploy after merging #43 to #47 | The backend deploys to QA were all **cancelled** by queued website deploys (one shared queue slot), so QA kept an old backend | Fixed in #49; the backend was deployed by hand meanwhile |
| F4 | Emulator, rider app | On the delivery screen "COD: collect ₹245.90" was drawn over the label of the cash field | Fixed in #51, with a test that fails without the fix |
| F5 | Emulator, rider app | A rider who is online but never answers an offer is not offered that order again (by design: each rider is tried once), and the missed offer lowers their acceptance rate (100% to 94%) | Not a bug; noted for ops training |

## Who was logged in
| Person | Phone | Used on |
|---|---|---|
| Customer A | 9100000001 | consumer app: address, store, cart, checkout, cash order |
| Customer B | 9100000002 | consumer app and API: delivered order, ratings, tip; proves A and B do not see each other |
| Store owner | 9000000201 (Ramesh Stores) | partner app: accepts, requests a rider |
| Rider | 9000000101 | rider app: offer, pickup, delivery, profile (SOS was not pressed) |
| Ops | QA ops user (email, password, one-time code) | console |
| Extra customers, second store, second rider | fresh numbers, 9000000202, 9000000102 | API campaign |

## 1. API scenarios (LC-nn)
Each scenario signs in as several people and asserts what each may see and do. "QA" ran with the real OTP limits.

| ID | Scenario | What is asserted | QA | Fake |
|---|---|---|---|---|
| LC-01 | Sign-in with bad numbers, a wrong code, an unknown challenge | 400 for `12345`, `98765abcde`, empty, a foreign number; wrong or unknown code refused | pass | pass |
| LC-02 | No token, a made-up token | 401 on `/me`, `/orders` (read and place) | pass | pass |
| LC-03 | A customer on partner and ops endpoints | 403/404 on `/merchants/me*`, 401/403 on `/ops/*` | pass | pass |
| LC-04 | A rider on partner endpoints; a store owner on ops | refused | pass | pass |
| LC-05 | One phone on two devices, signing out one | the other keeps working | skipped (QA resend cooldown) | pass |
| LC-10 | The bill adds up | lines, fees, taxes are whole paise and the total is positive | pass | pass |
| LC-11 | Empty cart, bogus quote, unknown address | refused with 4xx | pass | pass |
| LC-12 | Idempotency | no key gives 400; the same key twice gives the same order, never two | pass | pass |
| LC-13 | Quantity 0, -1, 1.5, 100000 | 400, or not placeable | pass | pass |
| LC-20 | **Three customers order from one store at once** | three different orders and codes; each customer sees only their own; reading, tracking or cancelling another's order gives 404; the store sees all three with **no delivery address before accepting** | pass | pass |
| LC-21 | Store rejects one order, accepts another | states are independent (REJECTED, PREPARING); a rejected order cannot be accepted, an accepted one cannot be rejected; the address shows after accepting | pass | pass |
| LC-22 | Customer cancels before accept, and after | cancel works while PLACED, a second cancel and a cancel after accepting give 409 | pass | pass |
| LC-23 | Another store tries to accept | 403/404 and the order stays hidden from it | pass | pass |
| LC-30 | Delivery OTP | a wrong OTP is refused and the order stays undelivered; the right one delivers; delivering twice is refused | pass | pass |
| LC-31 | Ratings | not before delivery (409), not by a stranger (404), 6 stars refused (400), once only (409); **delivery stars for a store-staff delivery are saved** (ADR-039) | pass | pass |
| LC-32 | Problem report | a stranger cannot read or report it; one missing-item report per order | pass | pass |
| LC-40 | Two riders offered one job | the first to accept gets it, the second is refused | skipped on QA (needs controlled rider state) | pass |
| LC-50 | Ops sign-in API | right password works; wrong password and unknown email refused | pass | pass |

## 2. Public website
Run with Chrome on QA. English and Telugu, desktop 1600 px and phone 390 px. Every page must load (HTTP 200), show its
heading, have the right security headers, and not scroll sideways on a phone.

| ID | Page | Result | Evidence |
|---|---|---|---|
| W-01 | Home | pass | ![](screenshots/web-public/01-public-landing-en.png) |
| W-02 | For stores | pass (desktop) | ![](screenshots/web-public/02-public-for-stores-en.png) |
| W-03 | For riders | pass | ![](screenshots/web-public/03-public-for-riders-en.png) |
| W-04 | Home kitchens | pass | ![](screenshots/web-public/04-public-home-kitchens-en.png) |
| W-05 | Privacy, Terms, Grievance | pass | ![](screenshots/web-public/05-public-legal-privacy-en.png) |
| W-06 | Telugu: home, for stores, privacy | pass | ![](screenshots/web-public/08-public-landing-te.png) |
| W-07 | Phone: home | pass | ![](screenshots/web-public/11-phone-landing.png) |
| W-08 | **Phone: for stores** | **fail on QA (F2)**: the page is 53 px wider than the screen, so the dark header and footer stop short and the cards run past the edge. Fixed in #50 | ![](screenshots/web-public/12-phone-for-stores.png) |

## 3. Ops console
Signed in with email, password and the one-time code. Each section must open without an error and without bouncing back to the sign-in page.

| ID | Check | Result | Evidence |
|---|---|---|---|
| OPS-01 | Sign-in page | pass | ![](screenshots/web/01-ops-01-login.png) |
| OPS-02 | Overview | pass | ![](screenshots/web/02-ops-02-dashboard.png) |
| OPS-03 | Merchant review queue | pass | ![](screenshots/web/03-ops-merchants-queue.png) |
| OPS-04 | Orders | pass | ![](screenshots/web/04-ops-orders.png) |
| OPS-05 | Riders | pass | ![](screenshots/web/05-ops-riders.png) |
| OPS-06 | Live operations | pass | ![](screenshots/web/06-ops-live-operations.png) |
| OPS-07 to 19 | Support chat, reviews, refunds, disputes, payouts, reports, promos, micro-markets and fees, master catalogue, leads, grievances, audit log, privacy requests | all pass | files `07-` to `19-` in `screenshots/web/` |
| OPS-20 | **Order page of a delivered order**: items, the delivery address, "Leave at the door", the new **At the door** card (courier, time, confirmed with the customer's OTP, cash collected, door photo), the timeline and every message sent | pass | ![](screenshots/web/20-ops-order-detail.png) |
| OPS-21 | The same order page and the overview in Telugu | pass | ![](screenshots/web/21-ops-order-detail-te.png) |
| OPS-22 | Wrong email or password | refused with a message, stays on sign-in | ![](screenshots/web/23-ops-login-refused.png) |
| OPS-23 | Customer, store and rider tokens on the console API | all refused (401/403) | (API check, no picture) |

## 4. The apps on the emulator (one order, two customers)
Android 35 emulator, QA flavor of the apps, GPS set to Dargamitta. Customer A orders on the app; the store owner accepts on
the partner app and asks for a Santha rider; the rider delivers; customer B repeats the delivery part so the two customers
can be compared. Screens are 1080 x 2400.

| ID | Step | Expected | Result | Evidence |
|---|---|---|---|---|
| APP-C1 | Consumer A signs in with phone and code | home or address screen | pass | ![](screenshots/apps/consumer-01-login.png) ![](screenshots/apps/consumer-03-code-screen.png) |
| APP-C2 | "Use my current location" | permission prompt, map pin on the door; **"Leave my prepaid orders at the door"** switch is shown (ADR-036) | pass | ![](screenshots/apps/consumer-06-after-location.png) |
| APP-C3 | Save the address, see the feed | stores near the address, first-order offer | pass | ![](screenshots/apps/consumer-07-home-feed.png) |
| APP-C4 | Open Ramesh Stores, add two items | store card (rating, FSSAI, minimum order, "free delivery over ₹199"), item steppers, cart bar | pass | ![](screenshots/apps/consumer-08-store-page.png) ![](screenshots/apps/consumer-09-items-added.png) |
| APP-C5 | Cart then checkout | lines, item total ₹254, delivery fee struck through and **FREE** (over ₹199), platform fee ₹5, GST on fees, total ₹259.90; pay online or cash; tip choices; leave at my door | pass | ![](screenshots/apps/consumer-10-cart.png) ![](screenshots/apps/consumer-12-checkout-bill.png) |
| APP-C6 | Choose cash and place the order | "Order placed!", timeline Placed to Delivered, **Cancel order** until the store accepts, address | pass | ![](screenshots/apps/consumer-15-order-placed.png) |
| APP-M1 | Store owner signs in on the partner app | the new order rings at the top with **no delivery address**, while the older accepted order shows its address | pass | ![](screenshots/apps/merchant-02-home.png) |
| APP-M2 | Accept, then pick "Request rider" | choice of own delivery or a Santha rider; the order moves to Preparing and shows "Looking for a rider" with a pickup code | pass | ![](screenshots/apps/merchant-03-order-accepted.png) ![](screenshots/apps/merchant-05-after-accept.png) |
| APP-R1 | Rider signs in; the home has the new **profile** icon | offline home, today's numbers, cash with the rider | pass | ![](screenshots/apps/rider-02-home.png) |
| APP-R2 | Go online, pick the zone | zone chooser (Dargamitta ticked), location permission, "Online - Dargamitta" | pass | ![](screenshots/apps/rider-03-go-online.png) ![](screenshots/apps/rider-05-online-waiting.png) |
| APP-R3 | Offer arrives for customer B's order | "New order ₹30, pickup 0.4 km, drop 0.4 km, **Base ₹30 + distance ₹0**" with a 30-second Accept timer: the new pay rule (ADR-038) on a real order | pass | ![](screenshots/apps/rider-06-offer.png) |
| APP-R4 | Accept | job screen shows only the store while it is packing; the customer's address is not shown yet | pass | ![](screenshots/apps/rider-07-job-accepted.png) |
| APP-R5 | Enter the pickup code | picked up; **the exact customer address and the cash to collect (₹245.90) now appear** | pass (F4 overlap seen here) | ![](screenshots/apps/rider-09-picked-up.png) |
| APP-R6 | Arrived at the customer | "Waiting at the door" timer starts | pass | ![](screenshots/apps/rider-10-arrived-at-customer.png) |
| APP-R7 | A wrong delivery OTP (0000) | "That code is not right. Check and try again." and nothing is delivered | pass | ![](screenshots/apps/rider-11-wrong-otp.png) |
| APP-R8 | The right OTP | "Delivered. Well done!" | pass | ![](screenshots/apps/rider-12-delivered.png) |
| APP-R9 | **Rider profile** (ADR-040): name, vehicle, rating, acceptance, today's numbers, earnings, language, sign out; switch to Telugu | everything translated, no overlap | pass | ![](screenshots/apps/rider-14-profile-telugu.png) |
| APP-B1 | Customer B signs in | sees **only their own address**, none of customer A's | pass | ![](screenshots/apps/consumerB-01-after-login.png) |
| APP-B2 | B opens the delivered order | full timeline, "How was it?" with **store and delivery stars**, **"Say thanks with a tip"** (₹10 to ₹100, 24 hours), Report a problem | pass | ![](screenshots/apps/consumerB-03-delivered-order.png) |
| APP-B3 | B rates the store 5 and the delivery 4 | "Thanks for rating!", the rating is shown and cannot be sent twice | pass | ![](screenshots/apps/consumerB-04-rating-stars.png) ![](screenshots/apps/consumerB-05-rated.png) |

## 5. Privacy and isolation checked on the way
- A store does not see the customer's address until it accepts (LC-20, LC-21, APP-M1).
- A rider does not see the customer's address until pickup (APP-R4, APP-R5).
- Customers cannot read, track, cancel, rate or report each other's orders (LC-20, LC-31, LC-32, APP-B1).
- A store cannot act on another store's order (LC-23). A customer, rider or store owner cannot reach the console (LC-03, LC-04, OPS-23).

## 6. Not covered, and why
- **Online payment with Razorpay's test checkout and the tip payment**: completing them means typing test card or UPI details
  into Razorpay's page. Left for you to try on a phone; the payment logic itself is covered by the fake-mode payment and tip tests (ADR-037).
- **Push notifications** (no Firebase project yet), **WhatsApp codes** (Meta not set up; QA uses the fixed code 123456), **real SMS/calls** (mocks).
- **Real devices, slow networks, the Play Store builds**: only the emulator was used.
- **Load**: the k6 run on QA is still to do.
- **Two riders competing for one job** (LC-40) passes on fake; on QA it needs a controlled rider setup.
- **A wrong pickup code** was not captured on the emulator (the script's first attempt did not reach the field); the OTP wrong-code case (APP-R7, LC-30) is covered.

## 7. Re-running it
```bash
# API scenarios on QA (about 80 seconds)
E2E_TARGET=live E2E_API_URL=https://api.test.santhaapp.com pnpm --filter web e2e:live features/launch-campaign
# Console and public site with screenshots
E2E_TARGET=live E2E_API_URL=https://api.test.santhaapp.com E2E_SHOTS_DIR=../../docs/testing/screenshots/web pnpm --filter web e2e:live features/launch-screenshots
```
The ops credentials come from `apps/web/.env.e2e.local` (`E2E_OPS_EMAIL`, `E2E_OPS_PASSWORD`). The emulator steps are in
[launch-test-method.md](launch-test-method.md).
