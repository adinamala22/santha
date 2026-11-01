# ADR-005: In-memory fake mode for local testing
2026-11-01 · Status: accepted

## Context
Running the backend locally needs Docker (Postgres + PostGIS, Redis). On machines without admin rights Docker runs
inside WSL, which is slow to start and stops when idle. For UI work and quick device testing we want the API up
with demo data and nothing else installed.

## Decision
Add `DATA_STORE=memory` (default `postgres`), started with `pnpm dev:fake`. The real Nest app runs with each module's
storage port bound to an in-memory implementation, preloaded from the same demo list as the Postgres seed
(`apps/backend/src/dev/seed-data.ts`). Rate limits use an in-process fixed window. Outbox relay and queue workers are
off; committed domain events are written to the API log. The OTP provider is forced to the mock with code `123456`.
Env validation refuses memory mode unless `APP_ENV=dev`.

## Consequences / when to revisit
Every module that adds a repository port must also provide its in-memory implementation, kept in `src/` next to the
Prisma one and covered by the same unit tests, so the two cannot drift silently. Every milestone also adds
`test/fake/m<N>-<topic>.fake.spec.ts`, which boots the real app in memory mode (`test/fake/harness.ts`) and
automates that milestone's acceptance checks. These run as `pnpm --filter backend test:fake` and as the
"fake-mode acceptance" CI job. This is a standing check in `BUILD-PLAN.md` and a rule in the santha-backend skill. Features that depend on PostGIS
(serviceability, distance), transactional order transitions or BullMQ timers are not faithfully reproduced; they are
tested against the real stack and Testcontainers, never only in fake mode. Event consumers do not run in fake mode;
revisit when M1+ handlers need to (an in-process dispatcher is the likely answer).
