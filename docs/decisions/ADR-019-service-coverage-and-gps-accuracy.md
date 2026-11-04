# ADR-019: Service coverage ops can configure, "why not deliverable", and GPS accuracy

- Status: accepted
- Date: 2026-11-04

## Context
Customers in Nellore saw "not deliverable" for many addresses. An address is served only if it is inside an
effective micro-market polygon **and** within the store's delivery radius (`merchants.radius_m`, 500 m–10 km). The
demo seed has four ~2 × 1.7 km rectangles, so most of the city sits in the gaps. Ops could redraw polygons
(`/admin/micro-markets`, versioned) but not change a store's radius, and the app never said *why* an address was not
served. Separately, "Use current location" took the first GPS fix, often a cached or network position hundreds of
metres off, and saved it without letting the customer check it.

## Decision
- **Circle areas.** The micro-market editor gets a *Circle area* tool: centre + radius (0.5–25 km) → a 48-point
  polygon (`circleRing`, same projection as the backend `circlePolygon`). It is still stored as a polygon, so
  versioning, overlap checks and PostGIS serviceability are unchanged.
- **City-wide coverage.** `cities.coverage` (JSON, `{ nearestFallback, maxDistanceM }`, default off / 5 km).
  When on, a point in no area is served by the nearest effective micro-market (ST_Distance; in fake mode
  `distanceToPolygonMeters`) if it is within `maxDistanceM`. `MicroMarketsService.resolve` applies it, so feed,
  search, store pages, checkout and merchant onboarding all agree. `PUT /v1/ops/cities/{id}/coverage` (admin/ops),
  audited (`city.coverage_changed`) and emitted as `config.city_coverage_changed`. Seeded off: ops switch it on.
- **Store radius by ops.** `PUT /v1/ops/merchants/{id}/radius` `{ radiusM, reason }` (admin/ops), audited
  (`merchant.radius_changed`, before/after + reason), emits `merchant.updated` so the index rebuilds.
- **Why not.** `/v1/serviceability` adds `matchedBy` (`area` | `nearest`), `reason` (`outside_service_area`) and
  `nearest` `{ name, nameTe, distanceM }`. Store pages add `deliveryRadiusM` and `notDeliveringReason`
  (`outside_service_area` | `other_area` | `too_far`). The consumer app shows them (en + te).
- **GPS.** The consumer locator listens for up to 12 s at best accuracy, ignores fixes older than a minute, keeps
  the most accurate and stops at ≤ 20 m; falls back to the last known position. It reports accuracy and whether
  only approximate location is allowed. "Use current location" now opens the map pin at the fix with an accuracy
  circle and message, so the customer confirms the door; the pin page has "locate me". Event `gps_fix(accuracy_m,
  precise)`.

## Consequences
- An extra tap on "Use current location" (confirm on the map) in exchange for correct pins.
- With city-wide coverage on, fees/SLA/COD rules come from the nearest micro-market's version.
- Nearest-area lookup runs only when no area covers the point.
