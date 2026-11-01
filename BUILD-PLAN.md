# Santha — build plan for Claude Code

Work through the milestones in order. Each milestone has (1) the goal, (2) a prompt you can paste into Claude Code, (3) acceptance checks. Claude should read `CLAUDE.md` and the relevant skills before each milestone and stop at the end of each to let you verify. Expect roughly one to two weeks per milestone with Claude Code doing most of the typing and one engineer reviewing; adjust to your team.

Golden rule: **do not start a milestone until the previous one's acceptance checks pass.** Scope is the PRD's P0 list; Phase 2 items are parked.

---

## M0 — Repository foundations
**Goal.** Monorepo scaffold, local stack, CI skeleton, design tokens wired in, auth/OTP end to end.

**Prompt.**
> Read CLAUDE.md and the santha-architecture, santha-devops, santha-design-system skills. Scaffold the monorepo: pnpm workspaces for apps/backend, apps/web, packages/shared-types; melos for apps/consumer, apps/merchant, apps/rider and packages/santha_*. Create docker-compose.yml (Postgres 16 + PostGIS, Redis, Typesense, MinIO, Mailpit), .env.example, root README with the run commands. In apps/backend create the NestJS skeleton with the ten module folders, zod-validated config, Prisma with PostGIS enabled, the outbox table and relay worker, BullMQ queues, pino logging, OpenAPI generation, health endpoints, and the identity-kyc module with OTP request/verify (MSG91 mock), JWT access/refresh, roles and device binding. Generate packages/shared-types from the OpenAPI. In packages/santha_ui implement tokens.dart from design/tokens/santha_tokens.dart and santhaTheme(), plus a golden-tested SanthaButton, EtaChip, SelfDeliversBadge. Create the three Flutter apps with flavors dev/stg/prod, go_router, Riverpod, l10n (en, te) and an OTP login screen using santha_ui. In apps/web set up Next.js with tokens.css and tailwind.tokens.js, fonts, a placeholder landing route and /admin/login UI. Add GitHub Actions workflows per the devops skill (lint/typecheck/test only for now). Write docs/decisions/ADR-001-stack.md recording the stack.

**Acceptance.** `docker compose up` + `pnpm dev` runs; OTP login works from each Flutter app against the local backend; `melos run analyze test` and `pnpm test` green in CI; tokens render correctly (compare a screenshot to design/brand/santha-palette.png); OpenAPI JSON published to shared-types.

---

## M1 — Micro-markets, merchants and KYC
**Goal.** Ops can configure Nellore micro-markets; merchants can be onboarded, KYC-verified and approved.

**Prompt.**
> Implement analytics-config: micro_markets (PostGIS polygon, hours, fee rules, COD rules, SLA, rider pay table) with versioning (effective_from/effective_to) and an /ops/micro-markets API; feature flags via PostHog SDK. Implement merchant-catalogue's merchant side: create merchant (type: retail/fashion/home_business/home_kitchen), geo + radius, hours, default fulfilment mode, staff members; KYC flow with provider interface (PAN, Aadhaar offline/eKYC, GSTIN or exemption declaration, FSSAI number validation for food types, bank penny-drop) using the mock provider locally; approval states draft → submitted → approved/rejected → live; audit events; events merchant.created/kyc_updated/went_live. Build the merchant app onboarding feature (steps per PRD 9.4) and the admin console /admin/micro-markets (polygon editor with versions) and /admin/merchants onboarding queue with document review and approve/reject. Seed the four Nellore micro-markets and 12 demo merchants.

**Acceptance.** A merchant onboarded on the app appears in the admin queue and can be approved to live; FSSAI is mandatory for food types; micro-market edits are versioned and reflected in serviceability within 60 s; audit rows exist for every ops action.

---

## M2 — Catalogue and search
**Goal.** Merchants build accurate catalogues fast; consumers can search everything nearby.

**Prompt.**
> Implement catalogue: master_products (barcode, name, brand, MRP, pack, category, image) with an import script and open-barcode fallback; items (merchant SKU) with variants, units, price ≤ MRP rule, tri-state stock, veg/non-veg, allergens, lead time, category mapping; menus/slots/capacity for home kitchens; image upload pipeline to S3 (Sharp resize/WebP) with a moderation queue stub; staleness flag job (72 h); events item.*; Typesense indexing (collections items and merchants with geo field, synonyms incl. Telugu transliterations) and the search-discovery /search and /feed endpoints with ranking weights from config and ETA v1 (prep p50 + Routes travel cached by H3 pair + buffer; mock maps locally). Merchant app: catalogue list, barcode scan (mobile_scanner), add/edit item, stock toggles, bulk CSV import, menu/slot editor. Admin: catalogue QA queue and assisted-catalogue entry on behalf of a merchant.

**Acceptance.** Scan 50 barcodes → ≥80% resolve against seeded master data; search p95 < 400 ms locally with 20k items; home feed shows seeded stores with ETA chips; staleness flag appears after 72 h (use a clock override in tests).

---

## M3 — Consumer discovery
**Goal.** The consumer app home, search, store, product and home-kitchen screens match the mockups.

**Prompt.**
> Build consumer features location (GPS + manual pin + saved addresses + serviceability), home (indigo header, supply-type tabs, promo card, category grid, store cards), search (grouped by store, Telugu hints, inline ADD), store page (trust row, in-store search, categories, product grid, sticky cart bar), product sheet (variants, MRP, substitution info), home-kitchen page (slots with cut-offs, FSSAI/hygiene badges, veg/non-veg, portions, allergens). Use santha_ui components only; implement loading/empty/error/offline states; emit analytics events app_open, location_set, serviceability_result, feed_viewed, search_performed, merchant_viewed, item_viewed, add_to_cart. Match design/mockups/consumer-home-hifi.png and docs/wireframes/consumer/*.

**Acceptance.** Golden/screenshot of Home matches the mockup within token colours and layout; search returns grouped results; store page add-to-cart updates the sticky bar; works offline with cached catalogue and stale indicator; all strings present in en and te.

---

## M4 — Cart, pricing, payments, order placement
**Goal.** First paid order on staging.

**Prompt.**
> Implement cart-pricing: carts (single merchant, replace/save prompt), per-item substitution preference, computeQuote (items, delivery fee by distance/basket with free threshold, platform fee, small-order fee, packaging fee cap, GST, promo engine with budgets/limits/merchant share, MOV) snapshotting every quote; orders module: POST /orders with Idempotency-Key creating PLACED only after payment capture or COD authorisation (COD rules: retail/fashion ≤ ₹1,500, COD-enabled micro-market, user COD trust); payments-settlement: Razorpay provider (sandbox + mock), payment intents, webhooks with signature verification and idempotent processing, wallet (refund credits only). Consumer app: cart, checkout (ASAP vs slot, address + instructions, coupon, bill, UPI/card via Razorpay SDK, COD), order confirmation. Admin: /admin/promos.

**Acceptance.** Place a paid test order on staging with the Razorpay sandbox and see PLACED with correct bill; duplicate POST with same Idempotency-Key returns the same order; COD blocked for cooked food; promo budget exhaustion disables code within 1 min.

---

## M5 — Order lifecycle and the merchant flow
**Goal.** Orders move Placed → Ready through the merchant app with alerts in ≤5 s.

**Prompt.**
> Implement the order state machine (transition function, legal edges, timers as BullMQ delayed jobs, cancellation rules, auto-pause after two missed accepts), item unavailability with substitution handling and auto partial refunds, notifications module (templates en/te; FCM push, MSG91 SMS fallback, WhatsApp opt-in, voice-call fallback for merchant alerts via provider interface), WebSocket gateway rooms. Merchant app: Orders tab with ringing new-order card (full-screen intent, 20-s countdown), accept/reject with reasons, item "Have it / Substitute / Not available", pack timer, Mark ready; daily summary card. Consumer app: order status screen with timeline (tracking map comes in M6). Admin: /admin/orders/[id] timeline + comms log.

**Acceptance.** Alert reaches merchant app ≤5 s p95 in staging; two ignored orders auto-pause the store; substitution with price difference refunds to wallet instantly; illegal transitions rejected and logged.

---

## M6 — Hybrid fulfilment, rider app, tracking
**Goal.** Deliveries completed both by merchant staff and by Santha riders, with live tracking.

**Prompt.**
> Implement dispatch-tracking: fulfilment assignment (self/rider/3pl), merchant fulfilment choice at accept with platform overrides, staff link flow (tokenised web page + merchant app staff mode) with pickup code and OTP/photo proof, rider presence (Redis GEO), scoring, 30-s offer loop, batching rule, fallback ladder (3PL provider interface mock → self-delivery bonus → standby pool → customer notice), deterministic rider pay, ETA recompute and proactive delay notifications, live location fan-out to order rooms. Rider app: onboarding, online toggle with zones, offer screen with pay breakdown, job screen with navigation hand-off, pickup code, OTP/photo proof, COD handling, earnings. Merchant app: FulfilmentChoice screen per mockup. Consumer app: tracking screen with map, ETA, timeline, staff/rider card with masked call. Admin: /admin live orders (KPIs, map, needs-attention, table) and reassign/force-self actions.

**Acceptance.** End-to-end on staging: order delivered by staff (commission ladder and delivery-fee credit visible in merchant statement preview) and by rider (offer → accept → pickup → OTP delivery); fallback triggers after 5 min with no rider; live rider marker updates ≤2 s; admin can reassign.

---

## M7 — Money closes: settlements, refunds, issues
**Goal.** Finance reconciles to the paise; customers get recourse.

**Prompt.**
> Implement settlement runs (daily 02:00 IST) computing merchant payouts (item value + packaging + delivery fee if self-delivered − commission − adjustments) and rider payouts (weekly, daily option) with Razorpay Route transfers (sandbox), statements and GST invoice/credit-note PDFs to S3, TCS/TDS records, reconciliation job against aggregator reports with exceptions queue; refunds rules engine (issue type × value × trust score → auto/manual; wallet instant; source via API with status), issue reporting with windows (2 h cooked / 24 h retail / 48 h fashion returns with rider pickup), disputes with evidence and 48-h window, trust scores and fraud flags. Consumer app: order issues flow, wallet, ratings. Merchant app: earnings, statements, disputes. Rider app: earnings detail. Admin: /admin/payouts, /admin/refunds (approval limits, four-eyes), /admin/disputes, CSV exports.

**Acceptance.** Settlement for seeded delivered orders reconciles to the paise; ≥80% of seeded issue scenarios auto-resolve; four-eyes enforced above threshold; statements download with correct GST lines.

---

## M8 — Trust & safety, analytics, hardening, landing, beta
**Goal.** Launch-ready: moderation, analytics, performance, security, landing site, store listings.

**Prompt.**
> Implement trust-safety: image/text moderation queue with classifier stub, prohibited-item rules, ratings/reviews with moderation and merchant replies, grievance workflow and officer contact, DPDP consent records and data-principal request flow; analytics pipeline (domain events + PostHog export → ClickHouse, Metabase dashboards for funnel, on-time, fill rate, contribution per order, merchant health, rider utilisation); performance work (home ≤1.2 s p95, search ≤400 ms, cold start ≤2.5 s on a low-end profile), k6 load test at 5× peak, SAST/DAST fixes. Build the landing site per santha-web (hero, how it works, for stores, for home kitchens, riders, legal pages, lead forms, SEO, Lighthouse ≥90) and store link pages /s/[slug]. Prepare store listings (en/te), privacy policy, launch checklist, runbooks, on-call rota. Set up the closed beta: 30 merchants, 300 users, 10 riders on staging builds.

**Acceptance.** Beta for two weeks: on-time ≥85%, fill ≥95%, crash-free ≥99.5%, no P1 open; landing Lighthouse ≥90; pen-test criticals closed; DPDP artefacts in place.

---

## After launch (pilot sprints)
Order-again and personalised modules; merchant daily digest; rider tips; wallet at checkout; ETA model v2 from real data; dispatch weight tuning; Telugu copy polish; monthly architecture checkpoint against the "seams" list; city-2 configuration dry run in Month 8.

## How to brief Claude Code each session
1. "Read CLAUDE.md and the skills relevant to this milestone."
2. Paste the milestone prompt (or the part you are doing today).
3. Ask for a short design note (owning module, events in/out, config keys, audit, tests) before code when the task touches orders, money or dispatch.
4. Review the PR against the acceptance checks; ask Claude to add missing tests or Telugu strings rather than accepting partial work.
