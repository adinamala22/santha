---
name: santha-backend
description: How to build the Santha NestJS backend — module template, Prisma + PostGIS conventions, outbox events and BullMQ jobs, REST/OpenAPI and WebSocket gateway patterns, order transition function, pricing engine, dispatch engine, Razorpay webhooks and settlement runs, testing with Testcontainers, and seed data. Use for any task in apps/backend or when adding an endpoint, table, event, job, or integration.
---

# Santha backend (apps/backend)

Stack: Node 22 · NestJS · Prisma (PostgreSQL 16 + PostGIS) · Redis 7 · BullMQ · Socket.IO · Zod · Typesense client · OpenAPI (nestjs/swagger) · Vitest + Testcontainers. Read `santha-architecture` first.

## Layout
```
src/
  main.ts, app.module.ts, config/ (zod-validated env), common/ (guards, interceptors, idempotency, audit, errors)
  modules/<module>/
    <module>.module.ts  controller(s)  service(s)  repository.ts  dto/ (zod schemas → OpenAPI)  events/ (publishers, handlers)  jobs/ (BullMQ processors)  <module>.spec.ts
  infra/ (prisma, redis, typesense, s3, mailer, providers/{razorpay,maps,kyc,msg91,whatsapp,threepl} with interface + sandbox + mock)
prisma/ schema.prisma  migrations/  seed.ts
test/ e2e/  mocks/
```

## Rules
- One Prisma schema; each model gets `micro_market_id` where operational; money fields `Int` paise; timestamps `timestamptz`; soft-delete only for merchants/items.
- Geo columns are `Unsupported("geography(Point,4326)")`/`geography(Polygon,4326)` with raw SQL helpers in `infra/prisma/geo.ts` (ST_Within, ST_DWithin, nearest).
- Orders table is partitioned monthly (migration SQL, not Prisma-managed).
- `transition()` lives in `modules/orders/state-machine.ts`; it is the only writer of `orders.state`. Unit-test every legal and illegal edge.
- Events: write to `outbox` in the same transaction (`prisma.$transaction`), relay worker publishes to BullMQ queue `events`; handlers dedupe on `event_id` in `processed_events`.
- Jobs: queues `events`, `timers`, `dispatch`, `notifications`, `settlement`, `indexing`. Delayed timer jobs are keyed `order:{id}:{timer}` and removed on transition.
- Controllers are thin: validate (Zod) → service → DTO. Services own transactions. Repositories own queries.
- Auth: OTP via MSG91 (mock in dev), JWT access 15 min + refresh 30 d, device binding, roles in claims; `@Roles()` guard for ops; rate-limit OTP by phone/device/IP.
- Idempotency interceptor on money/order POSTs (Redis, 24 h).
- Audit interceptor on all `/ops/**` mutations.
- Providers behind interfaces with three implementations: `live`, `sandbox`, `mock`; selected by env. Dev/test never hit live providers.
- Webhooks: verify signature, persist raw payload, enqueue, return 200 fast; process idempotently.
- Errors: typed `DomainError` → HTTP mapping; never leak provider errors to clients.
- Logging: pino with request id and order id; PII redaction for phone/address.
- Every endpoint documented via decorators; `pnpm openapi:gen` writes `openapi.json` → `packages/shared-types` and Flutter `santha_api`.

## Key algorithms (implement as pure functions with tests)
- `pricing/computeQuote(cart, config, promos)` → lines, fees, taxes, total, eta range. Snapshot every quote on the order.
- `eta/estimate(merchant, address, hourOfDay)` = prep p50 (rolling 30 d) + travel (Routes, cached by H3 res-9 pair) + buffer(config).
- `dispatch/score(candidates, order, weights)`; `dispatch/offerLoop`; `dispatch/batchEligible(a, b)`; `dispatch/fallbackLadder`.
- `settlement/computeMerchantPayout(orders, config)`; `settlement/computeRiderPay(assignment, config)`; reconciliation matcher.
- `refunds/decide(issue, order, trustScore, rules)` → auto|manual, amount, destination.

## Testing
Unit for pure functions (≥90% on pricing, state machine, dispatch, settlement, refunds) · integration with Testcontainers (Postgres+PostGIS, Redis) for repositories, outbox, webhooks · e2e happy paths: place → accept(self) → deliver; place → accept(rider) → offer → deliver; cancel paths; refund flow. CI must pass before merge.

## Seed (`pnpm --filter backend seed`)
Nellore city; micro-markets Magunta Layout, Dargamitta, Balaji Nagar, Vedayapalem (approximate polygons, hours, fee rules, COD on for retail ≤ ₹1,500); 12 merchants across the four supply types with ~200 items; 3 riders; 2 consumers with addresses; config version 1; flags.
