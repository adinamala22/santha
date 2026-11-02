# ADR-008: M2 catalogue and search — data model, search engine port, images, ETA v1, staleness
2026-11-02 · Status: accepted

## Context
M2 (BUILD-PLAN) adds the catalogue, the master catalogue with barcode scanning, menus and slots for home
kitchens, the image pipeline, search and the home feed. The PRD and tech plan leave several choices open.

## Decision
- **Catalogue model.** Items belong to a merchant (merchant-catalogue owns them). Price and stock live on
  variants (`item_variants`); stock is tri-state (in / low / out). The selling price may never exceed the MRP,
  enforced in the service and by a DB check. Items are soft-deleted. Price changes write an audit row and an
  `item.price_changed` event (FR-CAT-6). The platform taxonomy is a code constant (en + te), because it ships
  with app releases rather than per micro-market.
- **Master catalogue.** `master_products` keyed by GTIN with check-digit validation. They are imported from
  CSV with `pnpm --filter backend catalogue:import`. The demo file (`prisma/data/master-products.csv`) uses
  fictional brands and synthetic GS1-India-prefix barcodes; replace it with licensed GS1/commercial data
  before launch. A scan that misses falls back to a `BarcodeLookupProvider`: Open Food Facts when live, a
  fixed table in dev/test. A full miss goes into the `barcode_requests` enrichment queue that ops work from
  the console.
- **Prohibited items (FR-CAT-7)** are screened by a keyword list in trust-safety (`TrustSafetyService`). A hit
  holds the item for review (status `in_review`) instead of refusing it, because harmless names can collide
  ("ginger beer"). Ops release or reject held items from the console. The image classifier will plug into
  the same service later.
- **Assisted entry (FR-CAT-3).** Ops create items or paste a list for a merchant. Those items are
  `pending_merchant` until the merchant approves them in the app (one by one or all). Field-agent merchant
  onboarding (creating the store for someone) stays manual: ops build the catalogue, and the owner still
  self-onboards for KYC.
- **Images.** Clients upload straight to a presigned URL (S3/RustFS; an in-memory store with an HMAC-signed
  dev route in fake mode), then call `complete`. Sharp makes a 320 px square WebP thumbnail (kept within
  40 KB by stepping down quality) and a 960 px medium image. Every photo goes to a moderation queue; customers
  only see approved photos. Locally, RustFS gets a public-read policy on `media/` only; in AWS, CloudFront
  serves it through origin access. Store photos (moved from M1 by ADR-006) are now an onboarding step.
- **Search engine port.** `SearchIndex` has two implementations: Typesense (Postgres mode) and an in-memory
  inverted index (fake mode and tests), with the same synonym table (English ↔ Telugu transliteration ↔
  Telugu script). Engines return text-relevance hits only. Grouping by store, the delivery radius (FR-LOC-4),
  open/closed ordering and ranking happen in `DiscoveryService`, so results don't depend on the engine.
  The index is fed by catalogue events (outbox → BullMQ → indexer) and rebuilt at boot by the worker process
  (always in fake mode), and on demand with `search:reindex`. The Typesense PG-trigram fallback (tech plan
  4.4) is deferred to M8 hardening.
- **Ranking and ETA v1** use a new `discovery` section in the versioned micro-market config: weights for
  distance, ETA, rating, acceptance and freshness; the text/store blend for search; default prep minutes per
  store type; ETA range; and the rating assumed for new stores. Older versions read as defaults.
  ETA = prep (default until M5 has 30 days of orders) + travel + `sla.etaBufferMin`. Travel comes from a
  `MapsProvider` (Google Routes when live; straight line × 1.4 at 18 km/h as the mock) and is cached per H3
  res-9 cell pair for 24 h (Redis; in-process in fake mode). Kitchens with slots show "Scheduled" and their
  next open slot instead of an ETA.
- **Staleness.** Items not confirmed within `sla.staleCatalogueHours` (72 h by default) are flagged by a
  BullMQ repeatable job (an in-process timer in fake mode). Ops can also run it, which is audited. A stock
  toggle confirms one item; "everything is as listed" confirms all. Stale items stay listed but rank lower.
- **Fake mode.** In-memory stores now deliver committed events to handlers in-process (after commit and
  outside the store lock, deduped per consumer), so search indexing works without Redis. A forward-only dev
  clock (`POST /v1/dev/clock`) makes time-based features testable and demoable.
- **Merchant app bulk import is paste-based.** `file_picker` 10/11 does not build with this Flutter's
  built-in Kotlin. Merchants paste rows copied from Sheets/Excel or WhatsApp. Long lists go through ops
  assisted import. Revisit when a compatible file picker exists.
- **Console e2e runs on a production build** (`next build && next start`). The dev server's compile workers
  crashed under the longer suite. Ops-login rate limits are now configurable
  (`OPS_LOGIN_LIMIT_PER_EMAIL_HOUR`, `OPS_LOGIN_LIMIT_PER_IP_HOUR`; defaults unchanged) so tests can relax them.

## Consequences / when to revisit
- Order flows (M4/M5) must enforce slot cut-off and capacity using `slotOccurrences` (booked counts come
  from orders), and must re-confirm stale items at acceptance.
- Replace the demo master CSV with licensed data before launch. Open Food Facts data is ODbL.
- Typesense 30 deprecates per-collection synonyms in favour of synonym sets: migrate when upgrading the
  server image.
- Rating, acceptance rate and prep p50 are null until M5/M7 provide them; ranking uses neutral defaults.
