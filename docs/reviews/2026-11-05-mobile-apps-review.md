# Mobile apps review: bugs, gaps and next features (2026-11-05)

Scope: the code of the consumer, merchant and rider Flutter apps (`apps/consumer`, `apps/merchant`, `apps/rider`) at `fix/deploy-order` (`df1aa20`), checked against the PRD v0.9 MVP scope and ADR-021/022 (city-wide stores, 5 km radius, Deliver anywhere). This was a code review, not a device test: every item below needs reproducing on the emulator before and after its fix.

**Status (2026-11-05):**
- **Fixed** in the bug-fix PR (`fix/mobile-review-bugs`):
  - Consumer: C1–C10.
  - Merchant: M1–M6 (M2 needed the backend: hours may now run past midnight).
  - Rider: R1–R3.
  - Shared: S1.
  - G7: release builds take `apps.mapTilesUrl` from the values file. **A tile provider still has to be chosen and the URL set.**
- **Separate PRs:**
  - G3 + G4: the rider fixes.
  - G1: push notifications.
  - G2: support chat.
- **Not started:** G5, G6, R4.
- **Withdrawn:** S2. `apiError` maps codes to friendly texts, so it is not a bug.

Severity: **P0** breaks a core flow or loses money or orders. **P1** a real bug that users will hit. **P2** a polish or edge-case issue.

## 1. Gaps that block launch (PRD MVP items not built)

| # | Gap | Where | Why it matters |
|---|---|---|---|
| G1 | **No push notifications in any app.** There's no Firebase/FCM dependency. The backend has `PUT /v1/me/push-token`, but no app calls it. | all three apps | Order alerts only work while the app is open. A merchant with the phone locked misses new orders, the accept window runs out, and the store is auto-paused for missed orders. Riders miss offers. Customers hear nothing about their order unless they turned on WhatsApp updates. |
| G2 | **No support chat** (PRD: "Post-order … support chat"; rider app: "support"; "chat with templated messages"). Customers can only file a grievance (Account → Privacy and help) or report a problem *after* delivery. | all three apps | During an active order there is no way to ask for help. See section 4. |
| G3 | **The rider location stops when the app is in the background.** Position is sent by a foreground `Timer` (`rider/lib/features/home/data/rider_controller.dart:57`) using `getCurrentPosition`. "Navigate" hands off to Google Maps, which puts our app in the background. | rider | Live tracking freezes for the whole ride: the customer's map stands still and the ETA is wrong. Needs a foreground service (Android) or background location mode (iOS) while a job is active. |
| G4 | **The rider can't mark a failed delivery.** The state machine allows `OUT_FOR_DELIVERY → FAILED_DELIVERY` by the rider, but there is no API route or button for it. | rider + backend | When the customer doesn't answer or isn't home, the rider has no way out. The order stays "out for delivery" until ops step in. |
| G5 | **No photos on problem reports or proof of delivery** (PRD: issue "photo upload", rider "proof of delivery (photo/OTP)"). | consumer, rider | Damaged/wrong-item refunds are decided without evidence. A delivery without an OTP has no proof. |
| G6 | **The merchant can't call the customer.** The customer picks "Call me" as the substitution preference for each item, but the merchant app has no masked call button. The backend only issues store↔courier numbers. | merchant + backend | The "Call me" choice can't be honoured. The store has to guess, or remove the item. |
| G7 | **Release builds use the free OpenStreetMap tile server.** `apps-release.yml` passes only `API_BASE_URL`, so `MAP_TILES_URL` falls back to `tile.openstreetmap.org` (`consumer/lib/features/location/map_pin_page.dart:16`, `orders/tracking_view.dart:15`). | consumer | OSM's usage policy forbids app traffic at scale; tiles can be blocked. ADR-007 says production uses Google/MapTiler tiles. |

## 2. Bugs

### Consumer app

| # | Sev | Bug | Where | Repro / effect |
|---|---|---|---|---|
| C1 | P1 | **Signing out keeps the cart and the delivery location** (and the cached feed). `signOut()` clears only the tokens and the profile. | `packages/santha_core/lib/src/auth/auth_controller.dart:97`; keys `santha.cart`, `santha.location` | Sign out, then sign in as another number on the same phone: the previous person's cart and home location are still there. This is a privacy issue on shared family phones. |
| C2 | P1 | **Adding an address from checkout drops you on Home.** "Add address" opens the map pin, whose save calls `context.go('/')`. | `checkout_page.dart:210`, `map_pin_page.dart:93` | Checkout → Add address → Save. You land on Home, not back in checkout, and checkout's work is lost. The "Add new" in the address picker (`checkout_page.dart:324`) also doesn't select the new address afterwards. |
| C3 | P1 | **Checkout can bill a different address than the one you browsed.** If the delivery location is a GPS pin (no saved address), checkout silently uses the *default saved address* (`checkout_page.dart:87`, `_reprice`). | checkout | You browse at your current spot (stores, ETAs and the beyond-radius fee are for that spot), then checkout prices the order to your home address. The fee or deliverability can change without warning. |
| C4 | P1 | **Deleting the address you're delivering to doesn't update the location**, and delete/make-default errors aren't caught. | `home/presentation/shell.dart:97` | Account → delete the current address. Home still shows it, and checkout later fails. An unhandled exception is thrown when offline. |
| C5 | P2 | The store page shows the **ETA chip next to "Closed · opens at …"**. | `store/store_page.dart:381` | It suggests the store will deliver in "20–30 min" while it's closed. Hide the ETA when `!s.open`. |
| C6 | P2 | **The "Report a problem" button stays after the report window closes**; the error only appears after the form is filled in. | `orders/after_delivery.dart:106` | Hide the button, or show "window closed", using the deadline from the order. |
| C7 | P2 | **Cart and checkout show English names in Telugu mode.** The cart stores `store.name` and `i.name`, not the Telugu display names. | `cart/cart_controller.dart:138,141` | In Telugu, the cart, the cart bar and the replace-cart dialog show English names. Store `nameTe` too. |
| C8 | P2 | The **"Place order" button can stay spinning** if the payment sheet throws something that isn't an `ApiException`. Only `ApiException` resets `_placing`. | `checkout_page.dart:150` | Add a `catch (_)` that resets the button and shows the generic error. |
| C9 | P2 | The **header ETA** ("15–20 min") is the fastest of *all* open stores, including ones that can't deliver to you. | `home/presentation/home_page.dart:65` | Filter to `s.deliverable`. This rarely matters inside the city (ADR-022), but it is wrong at the edge of the service area. |
| C10 | P2 | `issuesProvider` and `myRatingProvider` use Riverpod's default automatic retry, unlike every other provider (`_noRetry`). | `orders/after_delivery.dart:13,16` | When offline they retry silently in a loop instead of showing "Try again". |

### Merchant app

| # | Sev | Bug | Where | Repro / effect |
|---|---|---|---|---|
| M1 | P1 | **The Store hours page flattens per-day hours.** It loads only the first day's range and saves that one range to every open day. | `orders/presentation/store_hours_page.dart:29` | Mon–Sat 9–21 and Sun 10–14. Open Store hours and press Save: Sunday becomes 9–21. Ops/admin can set per-day hours (ADR-021), and the app then overwrites them. |
| M2 | P1 | **Late-night hours can't be saved.** Close must be later than open as text, so 18:00–01:00 is refused. | `store_hours_page.dart:54` | This blocks late food stalls and bakeries. Either support overnight ranges or say "closes at midnight latest" in the hint. |
| M3 | P1 | **The "Closed by hours" banner doesn't update over time.** `view.openNow` comes from the last `GET /merchants/me`. | `orders/presentation/orders_page.dart:43` | Leave the app open past closing time: there's no banner and no "Open now" button until a restart or pull-to-refresh. Refresh the view on a timer, or work it out from the hours on the device. |
| M4 | P1 | **"Deliver myself now"** (no-rider fallback) has no error handling and always assigns the owner, even when the store has delivery staff. | `orders/presentation/fulfilment.dart:200` | An offline tap throws an uncaught error, and there's no staff choice. Reuse `chooseFulfilment` and `_run`. |
| M5 | P2 | **Switching tabs** (Preparing/Ready/Out/Done) has no error handling. On failure the chip changes but the list is from the old tab. | `orders/data/orders_controller.dart:79` | |
| M6 | P2 | **Owner self-delivery is awkward.** The owner gets only a "Copy link" for the staff web page to do pickup, OTP and location. | `fulfilment.dart` | Add an in-app "Start delivery" that opens the link (or a native screen). Customers of "Deliver anywhere" stores rely on this live tracking (ADR-022). |

### Rider app

| # | Sev | Bug | Where | Repro / effect |
|---|---|---|---|---|
| R1 | P1 | **The cash field refills itself.** The COD amount is written back whenever the field is empty, so a rider who clears it to type a new amount sees it jump back. | `home/presentation/job_page.dart:113` | Set it once, in `initState` or on the first build of the job. |
| R2 | P1 | **Online/offline, Decline and zone changes have no error handling.** A failed call throws an uncaught error, and the switch doesn't move or says nothing. | `home/presentation/home_page.dart:114,203` | |
| R3 | P2 | **The "Location is off" hint doesn't update.** It is read with `ref.read` from a plain field on the controller, so it changes only when something else rebuilds the screen. | `home_page.dart:51` | Make it part of the state. |
| R4 | P2 | **No location for the "Arrived" check** and no distance-to-store guard: "Arrived" can be tapped from anywhere. | `job_page.dart` | This is fine for MVP; log the position with the tap so ops can audit it. |

### Shared

| # | Sev | Bug | Where |
|---|---|---|---|
| S1 | P2 | **Realtime falls back to polling only on some screens** (merchant board 15 s, rider 10 s, consumer order 20 s). The consumer's Orders list and Home never refresh by themselves. | `consumer/lib/features/orders/orders_page.dart` |
| S2 | — | ~~Error texts differ between apps~~ Withdrawn: the merchant and rider `apiError` maps codes to friendly texts. | — |

## 3. Features to build next (in suggested order)

1. **Push notifications (G1).** Add FCM to all three apps and register the token after sign-in (the endpoint exists). Merchant and rider order alerts use a high-priority channel with a ringing sound. Without this, stores will miss orders on day one.
2. **Support chat (G2).** See section 4.
3. **Rider background tracking and failed delivery (G3, G4).** Add a foreground service while a job is active, and a "Couldn't deliver" action with reasons (no answer, wrong address, customer refused) that alerts ops.
4. **Masked calls from the store to the customer (G6),** shown only for accepted orders.
5. **Photos on problem reports and proof of delivery (G5).** Reuse the media upload the merchant app already has.
6. **Order-again (consumer).** Rebuild the cart from a delivered order with one tap; it's the cheapest way to get repeat orders.
7. **Store favourites and "notify me when open" (consumer).** This fits ADR-021, since closed stores are listed.
8. **Rush hour (merchant).** A one-tap "busy, add 10 min" that stretches the prep time instead of pausing the store.
9. **Low-stock and stale-stock reminders (merchant).** A daily push: "12 items not confirmed for 7 days".
10. **Rider incentives (rider).** Show the progress toward today's target on the home card (PRD: "earnings and incentives view").
11. **In-app ratings prompt** after the second successful delivery (Play/App Store review).

Out of scope for MVP (PRD Phase 2; needs your go-ahead): multi-store cart, Try & Buy, kitchen subscriptions, ads, merchant SaaS, ONDC.

## 4. Support chat: proposed design

**What users get**
- **Consumer:** a "Help" button on every order (active or past) and in Account. It opens a chat about that order. The customer picks a topic first (late, missing item, payment, other) from quick replies; they can then type and attach photos. Replies arrive live and by push.
- **Merchant and rider:** a "Help" entry in More / the job screen, with the same chat to Santha support.
- **Ops console (`/admin/support`):** an inbox with the queue, filters (open, waiting on us, waiting on customer), the order timeline beside the chat, macros (templated replies, en + te), and the actions support already has (refund, cancel, call). Every action is audited.

**Backend: a new `support` module**
- **Tables:**
  - `support_threads`: id, requester user and role, order id (optional), topic, status (open, waiting_customer, waiting_support, resolved), assignee, timestamps.
  - `support_messages`: thread, author, body, attachments (media ids), templated key (optional), created_at.
- Prisma and in-memory implementations, as for every other port (ADR-005).
- **REST:**
  - `POST /v1/support/threads`, `GET /v1/support/threads`, `GET /v1/support/threads/:id`, `POST /v1/support/threads/:id/messages`.
  - Ops: `GET /v1/ops/support/threads`, `POST /v1/ops/support/threads/:id/assign`, `POST /v1/ops/support/threads/:id/resolve`.
- **Realtime:** a `support.message` event on the existing gateway; push when the app is closed (needs feature 1).
- **Rules:** phone numbers are never shown in chat. Attachments use the existing media upload. A rate limit stops spam. Grievances (DPDP) stay a separate legal channel, but a chat can be escalated into one.
- **Events:** `support_thread_opened`, `support_message_sent`, `support_thread_resolved`, `support_first_response_time`; also listed in `docs/events.md`.
- **Tests:** fake-mode acceptance (`test/fake/support-chat.fake.spec.ts`), Playwright for the ops inbox, and widget tests for the chat screen.

**Quick option for launch week, if the full chat isn't ready:** a "Chat on WhatsApp" button that opens `wa.me/<support number>?text=Order <code>` (the WhatsApp Business number already used for OTP). It costs nothing to build, but the conversation isn't saved against the order and the console doesn't show it.
