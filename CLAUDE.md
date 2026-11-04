# Santha — project guide for Claude Code

Santha (సంత, "the weekly market") is a **no-store hyperlocal quick-commerce marketplace** for Nellore, Andhra Pradesh: consumers buy from real neighbourhood shops, home kitchens and home businesses and get delivery in 30–45 minutes. The platform owns **no inventory, no warehouses, no dark stores**. Tagline: *The whole town, one app.* / *Ooru antha, okka app lo.*

This repository is a monorepo for everything we ship: backend, three Flutter apps, the web (landing + ops/admin console), infrastructure and design.

## Read these before non-trivial work
- `BUILD-PLAN.md` — the ordered milestones (M0–M8) with the prompt and acceptance checks for each. Work in this order; do not start a later milestone before the earlier one's checks pass.
- `.claude/skills/santha-architecture/SKILL.md` — module boundaries, events, API shape, money and state-machine rules. **Invariants here are not negotiable.**
- `.claude/skills/santha-design-system/SKILL.md` — colours, type, components, logo rules. Every screen uses tokens from `design/tokens/`, never ad-hoc hex values.
- Per-surface skills: `santha-backend`, `santha-flutter`, `santha-web`, `santha-devops`.
- Source documents: `docs/Santha-PRD-v0.9.docx` (what/why), `docs/Santha-BRD-v0.9.docx` (business), `docs/Santha-Tech-Design-and-Dev-Plan-v0.9.docx` (how), `docs/diagrams/`, `docs/wireframes/`, `design/mockups/`.

## Repository layout
```
apps/backend     NestJS (TypeScript) modular monolith — REST /v1, WebSocket gateway, BullMQ jobs
apps/consumer    Flutter consumer app (Android first, iOS same code)
apps/merchant    Flutter merchant app (+ "staff mode" for self-delivery)
apps/rider       Flutter rider app
apps/web         Next.js: marketing/landing site (/), store link pages (/s/[slug]), ops/admin console (/admin)
packages/santha_ui, santha_api, santha_core, santha_offline, santha_maps   shared Flutter packages (melos)
packages/shared-types   TypeScript types + OpenAPI generated from backend, consumed by web
infra            Terraform (AWS ap-south-1), docker-compose for local, GitHub Actions workflows
design           tokens (json/css/tailwind/dart), brand assets, hi-fi mockups
docs             PRD, BRD, tech plan, diagrams, wireframes
```

## Stack (decided — do not substitute without updating the architecture skill)
- Backend: Node 22, NestJS, Prisma, Zod, Socket.IO, BullMQ, PostgreSQL 16 + PostGIS, Redis 7, Typesense, S3-compatible storage. Tests: Vitest/Jest + Testcontainers.
- Mobile: Flutter 3.x, Riverpod, go_router, Dio, Drift, freezed, flutter_localizations (en, te), Firebase (FCM, Crashlytics). Monorepo via melos.
- Web: Next.js 15 (App Router), TypeScript, Tailwind (tokens from `design/tokens/tailwind.tokens.js`), shadcn/ui, TanStack Query, MapLibre or Google Maps JS.
- Payments Razorpay (Route for split settlement; Cashfree as alternate). Maps Google Maps Platform. KYC Digio/Signzy. Comms FCM, MSG91, WhatsApp Business API, Exotel masking. Analytics/flags PostHog. Observability OpenTelemetry → Grafana, Sentry.
- Infra: AWS Mumbai, ECS Fargate, RDS Multi-AZ, ElastiCache, S3 + CloudFront, Terraform, GitHub Actions. India data residency is mandatory.

## Conventions that apply everywhere
- Money is integer paise. Totals are recomputed from lines; never stored alone. GST shown as applicable.
- All geo in PostGIS `geography`. Serviceability = address inside a micro-market polygon (or, when ops enable city-wide coverage, within the city's max distance of the nearest one, ADR-019). Micro-market config is versioned with effective dates.
- Every order state change goes through one guarded transition function in a DB transaction and emits a domain event via the outbox. Never update `orders.state` directly.
- Every mutating ops action writes an `AuditEvent`.
- Idempotency-Key header is required on POST /orders, payment confirmation and refunds.
- Strings are externalised; every user-facing string exists in English **and Telugu** before a feature is "done".
- Phone numbers are masked between parties. Exact addresses are revealed to merchants only after acceptance and to riders only after assignment.
- No secrets in the repo. `.env.example` lists variables; real values live in AWS Secrets Manager / local `.env` (git-ignored).
- Feature flags (PostHog) for anything risky or per-micro-market.
- Every backend storage port has a Prisma and an in-memory implementation; the fake service (`pnpm dev:fake`, `DATA_STORE=memory`) must run each milestone's features with demo data from `apps/backend/src/dev/seed-data.ts` (ADR-005, santha-backend "Fake service").
- Definition of done: acceptance criteria met on staging, tests added, fake service updated with automated fake-mode acceptance tests (`test/fake/m<N>-*.fake.spec.ts`, green in `pnpm --filter backend test:fake` and CI), Playwright e2e added or updated for the change (`apps/web/e2e/features/<feature>.spec.ts`, plus `journeys/` if a core flow changes; live-safe so it also runs against test after deploy, see `docs/testing/e2e.md`), analytics events emitted and listed in `docs/events.md`, en+te strings, accessibility labels, error/empty/loading states, logs + metrics, docs updated.

## How to work in this repo
- Small, reviewable commits with conventional messages (`feat(orders): …`, `fix(dispatch): …`). One milestone step per PR where possible.
- Before writing code for a surface, open that surface's skill and the relevant mockup/wireframe. Match the mockup; ask only when the mockup and PRD disagree.
- When a decision is not covered by the docs, choose the simplest option consistent with the architecture skill and record it in `docs/decisions/ADR-nnn.md` (one paragraph is fine).
- Run the local stack with `docker compose up -d` (Postgres/PostGIS, Redis, Typesense, RustFS S3, Mailpit), or without Docker via `pnpm dev:fake` (in-memory backend + demo data). Seed data: `pnpm --filter backend seed` creates Nellore micro-markets, 12 demo merchants, 3 riders and 2 test consumers.
- Never call live payment, KYC or SMS providers from dev/test; use their sandboxes or the local mocks in `apps/backend/test/mocks`.

## Phase boundaries
MVP = PRD P0 requirements only. Items marked Phase 2 in the PRD (multi-store cart, Try & Buy, kitchen subscriptions, ads, merchant SaaS, ONDC) are **out of scope** — if asked to build one, point to the PRD and ask for confirmation first.
