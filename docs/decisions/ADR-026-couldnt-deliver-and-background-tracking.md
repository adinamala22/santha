# ADR-026: Couldn't deliver, and rider tracking in the background

Status: accepted (2026-11-05)

## Context
The 2026-11-05 mobile review (`docs/reviews/2026-11-05-mobile-apps-review.md`, G3 and G4) found two gaps:
- **No way to fail a delivery.** The state machine allowed `OUT_FOR_DELIVERY → FAILED_DELIVERY` by a rider or staff, but there was no API or button for it. When the customer did not answer, the rider had no way out, and the order showed "out for delivery" until ops stepped in.
- **Tracking stopped in the background.** The rider app sent its position from a foreground timer. "Navigate" opens Google Maps, which puts the app in the background, so live tracking froze during the ride.

## Decision

### Couldn't deliver
- **Report:** the courier (rider app, or the staff page `/d/{token}`) reports it with a reason (`no_answer`, `wrong_address`, `customer_refused`, `unsafe`, `other`) and an optional note. This is only possible while the order is on its way.
  - The order moves to `FAILED_DELIVERY`, with `outcomeReason = delivery_failed_<reason>`.
  - The fulfilment becomes `failed` and gets a timestamp (new column `fulfilments.failed_at`).
  - An audit row `dispatch.delivery_failed` is written.
  - The customer is told (`customer.delivery_failed`: push, SMS and WhatsApp when opted in), and so is the store (`merchant.delivery_failed`).
- **The courier keeps the order.** A failed fulfilment stays active, so it stays on the rider's job list and they cannot take another job.
  - The courier can **try again** when the customer calls back. The order goes back to `OUT_FOR_DELIVERY`, the outcome reason is cleared, and the customer gets the "on the way" message again.
  - The customer can still call the courier through the masked number.
- **Ops decide** from the live board ("Needs attention: could not be delivered") or the order page:
  - **Send out again** (`POST /v1/ops/orders/:id/retry-delivery`), or
  - **Cancel** (`POST /v1/ops/orders/:id/cancel-failed-delivery`) **with or without a refund**, with a required reason.
  - Both are audited (`dispatch.delivery_retried`, `dispatch.failed_delivery_cancelled`).
  - A refund pays back what is left: wallet credit for captured online payments; nothing is owed on COD.
- **Not decided yet:**
  - Whether the rider is paid for a failed trip, and who bears the cost of the goods. Ops handle both manually until the business sets a rule.
  - Returning the goods to the store (ops tell the courier on the phone).

### Background tracking (rider app)
- While the rider is **online**, the app runs a location stream (geolocator):
  - **Android:** a location foreground service with a visible notification ("Santha Rider is online", en/te).
  - **iOS:** background location updates with the location indicator.
- The stream keeps sending positions while the rider uses Google Maps or locks the phone, at most one every 10 s. It stops (and the notification goes away) when the rider goes offline.
- The manifest declares `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `WAKE_LOCK` and `POST_NOTIFICATIONS`. The iOS `Info.plist` has `UIBackgroundModes: location` and the usage texts.
- The foreground timer stays as a fallback when the stream cannot start (location denied).

## Consequences
- `ACTIVE_STATES` for fulfilments now include `failed`. A cancelled order also ends a failed fulfilment, and the job leaves the rider's list.
- Location sharing continues while a failed delivery waits. It ends at delivery or cancellation, as before.
- Play Store review: a location foreground service needs the "location" foreground-service declaration in the Play Console, with a short video of the rider going online. Do this before the rider app's first release.
