# ADR-038: Long distance charge from 7 km, and rider pay of Rs 30 for the first 5 km

- Status: accepted
- Date: 2026-11-10
- Supersedes the radius and wording of ADR-022; changes the rider pay formula of ADR-017/M6.

## Context
The team reviewed the apps and asked for three things:
1. A customer within 7 km of the store pays the normal delivery fee and nothing more.
2. Beyond that, the bill line should read "Long distance charge", not "Extra delivery charge (far from the store)".
3. Rider pay: Rs 30 for a trip up to 5 km, then Rs 5 for each extra km.

## Decision
- **Radius.** The default store radius is 7 km (was 5 km). New stores get 7000 m; a migration moves every store still at
  5000 m to 7000 m. Ops can still set any radius per store; a store set to another value keeps it.
- **Label.** `billBeyondRadius` reads "Long distance charge" / "ఎక్కువ దూరం ఛార్జ్". The fee code `beyond_radius` and
  the Rs 30 surcharge are unchanged.
- **Rider pay.** `riderPay()` treats the base as covering the first `RIDER_PAY_INCLUDED_KM = 5` km of the trip (store to
  customer, rounded up to 0.1 km); only the km beyond it earn `perKmPaise`. The default `perKmPaise` is Rs 5 (was Rs 7 from the
  first km). The ops editor labels the field "Per km beyond 5 km". The same migration moves micro-market versions that
  still hold the old untouched default (base Rs 30, Rs 7/km) to Rs 5/km; versions ops had edited are left alone.
  The 5 km is a constant, not a setting, to keep the config shape stable.

## Consequences
- A 2 km trip now pays Rs 30 (was Rs 44); an 8 km trip pays Rs 45.
- Tests that needed a store with a 5 km radius set it through the ops radius endpoint.
- Existing orders keep the quote they were placed with.
