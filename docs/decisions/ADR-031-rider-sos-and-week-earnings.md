# ADR-031: Rider SOS and 7-day earnings

**Status:** accepted (2026-11-07) · **Context:** rider audit `docs/reviews/2026-11-07-rider-app-audit.md`, next steps 2 and 3.

## SOS

- **In the app:** an SOS button in the app bar of the home (approved riders) and the job screen. The dialog offers:
  - **Call 112:** dials first, so the alert never delays the call, then alerts Santha;
  - **Alert Santha only.**
- **The alert:** `POST /v1/riders/me/sos` carries:
  - the phone's position, or else the last known one;
  - the delivery in hand, if any;
  - whether 112 was called.

  One open alert per rider: a second press returns the same one. Each alert is audited (`rider.sos`) and logged at warn level.
- **Ops side:**
  - the alert is **first** on the live board's "Needs attention", in red, with the rider, the order, the minutes since, and a Google Maps link;
  - it links to the rider page, which shows the open SOS, the rider's phone as a tap-to-call link and the map;
  - ops resolve it there with a note of what happened (`POST /v1/ops/sos/:id/resolve`, audited as `rider.sos_resolved`; resolving twice gives 409);
  - the resolve form is on the rider page because the live board refreshes itself and would reset a half-written note.
- **The rider's full phone number** is shown to ops roles on the rider page so they can call back in an emergency. Masking rules apply between customers, stores and riders, not to Santha ops.
- **Not yet:** paging an on-call phone (SMS or call) when an SOS arrives. Today ops must have the console open. Add `OPS_ALERT_PHONE` with the call-masking provider once on-call duty is staffed.

## 7-day earnings

- `GET /v1/riders/me/earnings/week`: the last 7 IST days including today, oldest first, each with deliveries, pay and COD cash, plus the totals.
- The earnings screen shows them newest first, as bars, with weekday names in the app's language.

## Consequences

- Migration `20261118000000_rider_sos` (`rider_sos` table).
- Events:
  - `sos_pressed`(called_112, has_location) in the rider app;
  - audit `rider.sos` and `rider.sos_resolved`;
  - the live board attention kind `rider_sos`.
