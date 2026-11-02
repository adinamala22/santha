# ADR-009: M3 consumer discovery — addresses, store pages, offline cache, local cart, map pin
2026-11-02 · Status: accepted

## Context
M3 (BUILD-PLAN) builds the consumer app's location, home, search, store, product and home-kitchen screens,
"works offline with cached catalogue and stale indicator". The PRD leaves the storage, cart and map choices open,
and checkout/pricing only arrive in M4.

## Decision
- **Saved addresses** live in identity-kyc (`addresses` table, PostGIS `geography(Point)`, up to 10 per user,
  first one is the default; `/v1/me/addresses`). Each address stores the micro-market it resolved to, and the API
  re-resolves on every read so a polygon change shows up at once. The in-memory twin and a contract test keep the
  fake service in step (ADR-005).
- **Store page API.** `GET /v1/stores/:id?lat&lng` (public, like the feed) returns the store card, trust row
  (FSSAI verified, hygiene declared, rating), delivery info, categories with counts, every live item with sizes,
  and for home kitchens the next slot occurrences with cut-offs. `deliversHere` lets people browse a store that
  does not reach them without being able to add. Search gained category browse (`category` without `q`), "did you
  mean" hints with Telugu-script forms first, and the default size of every item for one-tap ADD.
- **Sign-in first, then location.** The app keeps M0's OTP-first flow, then asks for a delivery location
  (GPS, a map pin, or a saved address) before showing home. The backend endpoints stay public, so browse-before-
  login stays possible later behind a flag.
- **Offline = a JSON response cache, not Drift.** `santha_offline.JsonCache` stores the last feed per tab and
  every store page opened (keyed by a ~100 m cell), with a 15-minute freshness window and an LRU bound of 200
  files. Network first; on failure the cached copy is shown under a "You're offline · showing what we saved at
  …" banner. Search needs the network. Drift arrives with the merchant action queue in M5, where we need
  queries and conflict rules rather than whole-response replay.
- **Local single-store cart until M4.** The cart lives on the device (secure key-value store) and holds one
  store, as MVP requires (multi-store carts are Phase 2). Adding from another store asks to start a new cart.
  Kitchen carts carry the chosen slot. Prices are what the customer saw; M4 moves the cart to the server, which
  re-prices it.
- **Map pin** uses flutter_map with raster tiles from `MAP_TILES_URL` (OpenStreetMap by default in dev, with
  attribution), as in the ops console (ADR-007). Production points it at Google Maps or MapTiler tiles.
- **Retries.** Discovery providers turn off Riverpod's silent auto-retry. Failures show at once with "Try
  again" (or the offline copy).

## Consequences / when to revisit
The response cache is simple and needs no migrations, but it only replays pages that were opened before. Revisit
when M5 adds Drift: the consumer cache could move there if we need partial updates (e.g. stock pushes). The local
cart is replaced in M4. OSM tiles are not for production volume.
