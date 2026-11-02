# ADR-011: M5 order lifecycle, merchant alerts and notifications
2026-11-06 · Status: accepted

## Context
M5 (BUILD-PLAN) moves orders from Placed to Ready through the merchant app, with alerts within 5 s, accept
timers, auto-pause, item unavailability with refunds, notifications in en/te and a comms log for ops. Several
details are not in the PRD or tech plan: how timers run, when an order really expires, where partial refunds
go, which channels are live in dev, and how the realtime gateway scales.

## Decision
- **Timers.** One `Timers` service owns the `timers` BullMQ queue and routes jobs by name, so there is
  exactly one worker per queue (M4 had two workers on one queue taking each other's jobs). Order timers are
  delayed jobs keyed `order:{id}:{accept|sms|call}` and are removed when the store answers. In fake mode
  `MemoryTimers` holds them, and `POST /v1/dev/jobs/timers` fires the ones due at the dev clock.
- **Two deadlines.** `sla.merchantAcceptSec` (20 s) is the soft deadline the app counts down to. A
  reminder SMS follows at 30 s and a voice-call reminder at 60 s. The order expires at
  `sla.merchantAcceptHardSec` (120 s, versioned in the micro-market config). The store can accept at any
  point until the hard expiry; after the countdown runs out the card turns red but stays usable.
- **Auto-pause.** Two expired orders in a row (`MAX_MISSED_IN_A_ROW`) set `accepting_orders = false` with
  `paused_reason = missed_orders` and emit `merchant.auto_paused`. Any accept or reject resets the counter.
  The owner reopens the store from the app. A paused store shows as closed in discovery, and checkout
  returns `STORE_CLOSED`.
- **Item unavailable.** The store can remove a line or swap it for an in-stock item from its own catalogue
  at the same price or less. The difference is credited **to the wallet at once**, inside the same
  transaction as the line change. Source refunds come with M7's refund engine. For COD orders the cash due
  goes down instead. If the customer chose "remove it", no substitute is offered. When every line is
  removed, the order is cancelled.
- **Cancellation.** The customer can cancel for free only in PLACED (`canCancel`). After that, support
  handles it. Online payments are refunded to the wallet.
- **Notifications.** Templates are code (en + te) keyed by `<audience>.<event>`. Push goes through FCM HTTP v1
  using a service-account JWT (`PUSH_PROVIDER=fcm`, `FCM_SERVICE_ACCOUNT_B64`). SMS, WhatsApp and voice go
  through a messaging provider interface that has only a mock implementation for now. MSG91, WhatsApp
  Business and Exotel adapters plug in behind it later, and dev/test never calls them. WhatsApp is sent only
  after an explicit opt-in (`notification_preferences`). Every message is logged in `notifications` and
  shown on `/admin/orders/[id]`.
- **Realtime.** Socket.IO at `/v1/realtime` with rooms `user:{id}` and `merchant:{id}`, authenticated with the
  access token. A single instance is enough for MVP. The Redis adapter is added when the API scales past one
  task. The apps treat the socket as an accelerator only: the merchant board also polls every 15 s, and
  the consumer order screen every 20 s.
- **Ringing on the phone.** While the app is open, the merchant app plays the system alert and haptics for
  each new order. A full-screen intent and FCM high-priority data messages need a Firebase project per
  flavor. They are wired once those projects exist (see docs/deployment-and-costs.md), and until then
  the backend logs pushes through the mock provider.

## Consequences
Staging needs a Firebase project and `PUSH_PROVIDER=fcm` before the ≤5 s p95 alert criterion can be measured
on real devices. In fake mode the socket alert is asserted in `test/fake/m5-order-lifecycle.fake.spec.ts`.
Known follow-up: nestjs-zod/Swagger generates nullable top-level string fields as `string[]` in
`packages/shared-types` (runtime JSON is correct). Fix the generator before the web relies on more of
those fields.
