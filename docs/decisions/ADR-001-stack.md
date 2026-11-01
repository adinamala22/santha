# ADR-001: Technology stack and repository layout
2026-11-01 · Status: accepted

## Context
Santha needs one backend, three mobile apps (consumer, merchant, rider), a public website and an ops console,
built by a small team with Claude Code doing most of the typing. Data must stay in India (AWS ap-south-1).
The stack in `CLAUDE.md` was chosen in the tech design (`docs/Santha-Tech-Design-and-Dev-Plan-v0.9.docx`);
this ADR records it, plus the concrete versions and tooling choices made while scaffolding M0.

## Decision
**Monorepo**, two workspace systems side by side:
- **pnpm workspaces** (`pnpm-workspace.yaml`, pnpm 9 via corepack, Node 22): `apps/backend`, `apps/web`, `packages/shared-types`.
- **Dart pub workspaces + melos 7** (root `pubspec.yaml`): `apps/{consumer,merchant,rider}`, `packages/santha_{ui,api,core,offline,maps}`.

**Backend** — NestJS 11 modular monolith with the ten modules from the architecture skill; Prisma 6 on PostgreSQL 16 +
PostGIS (+ pgcrypto); Redis 7 via ioredis; BullMQ 5 queues (`events`, `timers`, `dispatch`, `notifications`,
`settlement`, `indexing`) used directly rather than through `@nestjs/bullmq`, so workers start only when
`RUN_WORKERS=true`; transactional outbox table relayed to the `events` queue (jobId = event id) with consumer dedupe in
`processed_events`; Zod 4 for env config and request/response schemas via `nestjs-zod` 5, which also drives the OpenAPI
document (`@nestjs/swagger`); nestjs-pino logging with PII redaction; Vitest 3 (+ SWC for decorator metadata) for unit
and HTTP tests, Testcontainers for integration tests. Local TS execution uses `@swc-node/register` (tsx/esbuild cannot
emit decorator metadata, which Nest DI needs).

**Contracts** — `pnpm openapi:gen` boots Nest in preview mode (no DB/Redis), writes `apps/backend/openapi.json`,
copies it to `packages/shared-types` (types generated with `openapi-typescript`) and `packages/santha_api`. CI fails if
the committed files are stale.

**Web** — Next.js 15 App Router, React 19, Tailwind 3.4 consuming `design/tokens/tailwind.tokens.js`; `tokens.css` and
brand files are copied from `design/` by `scripts/sync-brand.mjs` (git-ignored outputs, so `design/` stays the only
source); Poppins and Noto Sans Telugu via `next/font/google` (`display: swap`); Vitest + Testing Library.
An ESLint rule rejects hex colour literals in web code.

**Mobile** — Flutter ≥3.32 / Dart ≥3.8, Riverpod 3, go_router 16, Dio 5, flutter_secure_storage, flutter_localizations
with ARB files (en, te) generated to `lib/l10n/gen`. Fonts (Poppins, Noto Sans Telugu, OFL) are bundled in `santha_ui`.
Flavors dev/stg/prod: Android product flavors in `android/app/build.gradle.kts` + `main_<flavor>.dart` entry points.

**Auth (M0)** — phone OTP (MSG91 behind an `SmsProvider` port; mock locally), HS256 JWT access tokens (15 min) carrying
roles, device id and session id; opaque rotating refresh tokens (30 d) stored hashed, bound to the device, revoked on
reuse. The access token's `did` claim must match the `X-Device-Id` header on every authenticated request.

## Consequences / when to revisit
- Two package managers (pnpm + pub/melos) is deliberate: each ecosystem's native tooling. CI runs them as separate workflows.
- `santha_api` ships hand-written auth models in M0; switch to generated Dart models from `openapi.json` in M1 when
  the surface grows (keep the interceptors). Freezed/build_runner arrive with the first feature that needs them.
- iOS flavors (Xcode schemes/configs) are not set up in M0 — Android first per the PRD; add before the first TestFlight build.
- Ops console sign-in (email + password + OTP via NextAuth) is UI-only in M0; the backend endpoints land in M1 with the
  first ops-only feature.
- Revisit the Prisma major (7+) and Tailwind 4 once M1–M2 are stable; both are mechanical upgrades.
