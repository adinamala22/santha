---
name: santha-architecture
description: Architecture rules for the Santha hyperlocal marketplace — module boundaries, domain events, API shape, order state machine, money and geo invariants, hybrid fulfilment logic, and where the monolith splits later. Use before designing or changing any backend module, API, data model, event, or cross-app flow, and whenever a task touches orders, payments, dispatch, catalogue, or micro-market configuration. Also use to answer "how should X fit into the system" questions.
---

# Santha architecture

Santha is a modular monolith (NestJS) with three Flutter apps and a Next.js web app. The full design is in `docs/Santha-Tech-Design-and-Dev-Plan-v0.9.docx`; the diagrams in `docs/diagrams/` (architecture, order state machine, dispatch flow, data model) are the visual source of truth. This skill is the short, enforceable version.

## Modules (apps/backend/src/modules/*)
identity-kyc · merchant-catalogue · search-discovery · cart-pricing · orders · dispatch-tracking · payments-settlement · notifications · trust-safety · analytics-config

Rules:
1. A module owns its tables. Other modules read them only through the owning module's service or by consuming its events. No cross-module Prisma queries.
2. Modules talk synchronously only through exported services with explicit interfaces; everything else is a domain event (see `references/events.md`).
3. Events are written to the `outbox` table in the same transaction as the state change and relayed to BullMQ. Consumers are idempotent (dedupe on event id).
4. Config (micro-market polygons, fees, SLAs, rider pay, promo budgets, flags) lives in `analytics-config` with `effective_from/effective_to`; code reads config, never hard-codes a fee or an SLA.

## Invariants
- **Money:** integer paise; totals recomputed from lines + fee rows; GST per rules; settlement derived from Order + Fulfilment + Payment + Refund and reconciled to the aggregator to the paise.
- **Orders:** single `transition(orderId, to, actor, reason)` inside a transaction; legal transitions only (see `references/order-state-machine.md`); timers are BullMQ delayed jobs keyed by order id and cancelled on transition.
- **Geo:** PostGIS geography; serviceability = ST_Within(address, micro_market.polygon); merchant radius enforced server-side; rider positions in Redis GEO sets.
- **Privacy:** phone masking via click-to-call; addresses revealed to merchants after acceptance and riders after assignment; location sharing ends at delivery.
- **Idempotency:** `Idempotency-Key` on POST /orders, payment confirm, refunds; keys kept 24 h with the first response.
- **Audit:** every ops mutation writes `audit_events(entity, action, actor, before, after)`.
- **Tenancy:** every operational table carries `micro_market_id` (and `city_id` via micro-market) from day one.

## Hybrid fulfilment (the core differentiator)
On acceptance the merchant chooses `self` or `rider` (default from merchant settings; platform may force `rider` for fashion or low-SLA merchants). `self` → assign a registered staff member who gets a tracking link; commission ladder applies the lower rate and credits the delivery fee to the merchant. `rider` → dispatch engine scores candidates (distance, load, acceptance history, rating), offers for 30 s each, batches ≤2 orders when ETA impact ≤6 min, and runs the fallback ladder after 5 min (3PL quote → self-delivery bonus → standby pool → customer notice/cancel). Scheduled kitchen orders pre-book riders per slot. Details: `docs/diagrams/dispatch-flow.png`.

## API shape
REST JSON under `/v1`, OpenAPI generated from NestJS decorators and published to `packages/shared-types` and the Flutter `santha_api` package. WebSocket (Socket.IO) rooms: `order:{id}`, `merchant:{id}`, `rider:{id}`. Webhooks under `/v1/webhooks/{provider}` with signature verification and raw-payload storage. Endpoint list: `references/api.md`.

## When the monolith splits
Only on evidence: Kafka when event volume or multi-city needs it; extract dispatch when CPU/latency bound; dedicated Typesense cluster on index size; read replicas on DB read load. Keep the seams clean now so this is cheap later.

## Working with this skill
- New feature → identify owning module, its events in/out, its config keys, its audit events, its tests. Write that as a 10-line design note in the PR description before coding.
- If a request conflicts with an invariant, stop and explain the conflict; propose an alternative that keeps the invariant.
