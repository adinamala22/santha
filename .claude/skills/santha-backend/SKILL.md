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
  dev/ seed-data.ts (demo data shared by prisma/seed.ts and fake mode), fake-main.ts
prisma/ schema.prisma  migrations/  seed.ts
test/ e2e/  mocks/  fake/ (harness.ts + m<N>-<topic>.fake.spec.ts per milestone)  integration/
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

## Fake service (DATA_STORE=memory) — required in every milestone
`pnpm dev:fake` runs the real API with in-memory storage, no Docker (ADR-005). It must keep working as the backend grows, so **every milestone ships its fake service and its automated fake-mode tests, or it is not done**:
1. **Every storage port gets two implementations.** Repositories are abstract classes (see `identity-kyc/identity.repository.ts`). Next to the Prisma implementation, add `in-memory-<name>.repository.ts` in the same module folder (in `src/`, never in `test/`). Bind it in the module with a factory on `env.DATA_STORE` (see `identity-kyc.module.ts`). Emulate transactions the way `InMemoryIdentityRepository` does: serialised, snapshot and restore on throw, events delivered only after commit.
2. **Other infrastructure gets fakes too.** Redis-backed things (rate limits, idempotency keys, caches) get an in-process version. External providers (Razorpay, KYC, maps, MSG91, WhatsApp, 3PL) use their `mock` implementation; fake mode forces mocks. Geo queries get a simple in-memory fallback, e.g. point-in-polygon on the seeded micro-market polygons and haversine distance. Timers and queues run in-process or are triggered explicitly in tests.
3. **Demo data.** Add the milestone's demo records (micro-markets, merchants, items, addresses…) to `src/dev/seed-data.ts`. Both `prisma/seed.ts` and the in-memory stores load from it, so fake mode and the real stack have identical data.
4. **Automated fake-mode acceptance tests.** Add `test/fake/m<N>-<topic>.fake.spec.ts` using `bootFakeApp()` from `test/fake/harness.ts`. It boots the real `AppModule` with `DATA_STORE=memory` (no overrides) and drives the API over HTTP. Cover every acceptance check of the milestone that does not need PostGIS precision, real money movement or device hardware. Cover the error paths too (validation, illegal transitions, auth/roles, idempotency replays). Name tests after the acceptance check they prove.
5. **Same behaviour, two stores.** Repository behaviour that both implementations must share (uniqueness, compare-and-swap, ordering, rollback) goes in a contract spec. Run it against the in-memory store in `test:unit` and against Prisma in `test:int`, so the fake cannot drift from Postgres.
6. **Run it:** `pnpm --filter backend test:fake` locally; the `fake-mode acceptance` CI job runs it on every PR. `pnpm --filter backend test` runs unit + fake together.

Fake mode never replaces Testcontainers for PostGIS, order-transaction concurrency, outbox and webhooks. Those keep their integration tests.

## Testing
Unit for pure functions (≥90% on pricing, state machine, dispatch, settlement, refunds) · fake-mode acceptance per milestone (`test/fake`, above) · integration with Testcontainers (Postgres+PostGIS, Redis) for repositories, outbox, webhooks · e2e happy paths: place → accept(self) → deliver; place → accept(rider) → offer → deliver; cancel paths; refund flow (in fake mode, and against the real stack in integration). CI must pass before merge.

## Seed (`pnpm --filter backend seed`, and the fake store at boot)
Data lives in `src/dev/seed-data.ts`. Nellore city; micro-markets Magunta Layout, Dargamitta, Balaji Nagar, Vedayapalem (approximate polygons, hours, fee rules, COD on for retail ≤ ₹1,500); 12 merchants across the four supply types with ~200 items; 3 riders; 2 consumers with addresses; config version 1; flags.
