# Santha (సంత)

No-store hyperlocal quick-commerce marketplace for Nellore: local shops, home kitchens and home businesses,
delivered in 30–45 minutes. *The whole town, one app. · ఊరు అంతా, ఒక్క యాప్ లో.*

Start with `CLAUDE.md` (project guide), `BUILD-PLAN.md` (milestones M0–M8) and `.claude/skills/`.

## Layout
```
apps/backend     NestJS modular monolith (REST /v1, outbox → BullMQ, Prisma + PostGIS)
apps/web         Next.js — landing (/), ops console (/admin)
apps/consumer    Flutter consumer app          ┐
apps/merchant    Flutter merchant app          ├ flavors dev / stg / prod
apps/rider       Flutter rider app             ┘
packages/shared-types   TS types generated from the backend OpenAPI
packages/santha_ui      Flutter design system (tokens, theme, components, fonts)
packages/santha_api     Flutter API client (Dio, device-bound auth, token refresh)
packages/santha_core    Flutter config, storage, session + OTP sign-in flow
packages/santha_offline, santha_maps   scaffolds (M3/M6)
design/  docs/  infra/  .github/workflows/
```

## Prerequisites
- Node 22 (`.nvmrc`) with corepack: `corepack enable` (pnpm version is pinned in `package.json`).
  If `corepack enable` lacks permissions, prefix commands with `corepack`, e.g. `corepack pnpm i`.
- Docker for the local stack and integration tests: Docker Desktop, or (no admin rights) Docker Engine inside a
  WSL2 Ubuntu distro — ports are forwarded to Windows `localhost`. Keep a WSL session open (WSL stops idle distros).
- Flutter stable ≥ 3.32 and melos: `dart pub global activate melos`.

## Run locally
```bash
cp .env.example .env                      # local placeholders only; never commit .env
docker compose up -d                      # Postgres 16 + PostGIS, Redis, Typesense, MinIO, Mailpit
pnpm i                                    # also generates the Prisma client
pnpm --filter backend migrate:deploy      # or migrate:dev while changing the schema
pnpm --filter backend seed                # identities, micro-markets, merchants, master catalogue + demo items
pnpm dev                                  # backend :4000 (+ workers) and web :3000
```
- API docs: http://localhost:4000/docs · health: `/v1/health`, readiness: `/v1/health/ready`
- Landing: http://localhost:3000 · Ops sign-in UI: http://localhost:3000/admin/login
- Mailpit: http://localhost:8025 · S3 console (RustFS): http://localhost:9001
- Search runs on Typesense (`SEARCH_ENGINE=typesense`, the default with Postgres). The worker rebuilds the index at
  boot; `pnpm --filter backend search:reindex` rebuilds it on demand. Master catalogue import:
  `pnpm --filter backend catalogue:import <file.csv> [--dry-run]` (columns `barcode,name,brand,mrp,pack,category,image_url`).

### Fake mode (no Docker)
```bash
pnpm i
pnpm dev:fake                             # backend :4000 with in-memory data + web :3000
```
The backend runs with `DATA_STORE=memory`: no Postgres, Redis or Docker; the demo users below are preloaded,
the OTP code is always `123456`, and domain events are delivered in-process (the search index updates at once)
and written to the API log. Uploaded photos are kept in memory and served from `/v1/dev/media/…`. The clock can be
moved forward to try time-based features, e.g. `curl -X POST localhost:4000/v1/dev/clock -H 'content-type: application/json'
-d '{"hours":73}'` makes the catalogue stale (then run the sweep from the console or wait an hour). Everything
resets when the backend restarts. Use it for UI work and quick device testing; anything touching maps,
serviceability or order transactions needs the real stack above. Fake mode is refused outside `APP_ENV=dev`.

### Flutter apps
```bash
melos bootstrap                           # pub get for every package (+ l10n generation)
melos run platforms                       # once: generate android/ios files around our flavor config
melos run dev:consumer                    # or dev:merchant / dev:rider (Android emulator → http://10.0.2.2:4000)
```
Physical device: `flutter run --flavor dev -t lib/main_dev.dart --dart-define=API_BASE_URL=http://<your-LAN-IP>:4000`
(the dev flavor already allows cleartext HTTP; stg/prod do not).

**Signing in locally:** with `OTP_PROVIDER=mock` and `MOCK_OTP_CODE=123456` (the `.env.example` defaults) any valid
Indian mobile number signs in with code `123456` (new numbers get the role of the app they sign in from). Without
`MOCK_OTP_CODE`, the code is printed in the API log. Seeded demo users (same in fake mode and after `seed`):

| Role | Numbers |
|---|---|
| Consumer | 9000000001, 9000000002 |
| Rider | 9000000101 – 9000000103 |
| Merchant owner | 9000000201 – 9000000212 |
| Ops admin | 9000000900 |

**Ops console** (http://localhost:3000/admin/login): `admin@santha.local` / `santha-admin-dev` (dev-only seed
password, `SEED_OPS_PASSWORD`), then OTP `123456`. **Mock KYC**: Aadhaar OTP `123456`; numbers containing `0000`
(PAN digits, Aadhaar/account/FSSAI ending) fail, so failure paths are easy to try. Demo data: Nellore, four
approximate micro-markets (Magunta Layout, Dargamitta, Balaji Nagar, Vedayapalem) and 12 merchants
(8 live, 3 waiting for review, 1 draft) with ~200 items, kitchen slots and generated store photos.
**Demo master catalogue** (`apps/backend/prisma/data/master-products.csv`): 226 packaged goods with *fictional* brands
and synthetic barcodes, e.g. `8901000000019` (Annapoorna Chakki Atta 1 kg). Barcodes `8901058000290`,
`8901262010016` and `8906010500016` resolve only through the mock open-barcode lookup; anything else is "unknown"
and lands in the ops enrichment queue. **Try search:** `/v1/search?lat=14.4525&lng=79.995&q=biyyam` (Telugu
transliteration → rice), `q=pappu`, `q=tomoto` (typo); feed: `/v1/feed?lat=14.4525&lng=79.995&tab=home_kitchens`.
**Consumer app (M3):** sign in with `9000000001` and pick the saved Home address (Dargamitta): Ramesh Stores and
Saraswathi's Kitchen deliver there. Store page API: `/v1/stores/<id>?lat=14.4525&lng=79.995`.

## Checks (what CI runs)
```bash
pnpm lint && pnpm typecheck && pnpm test   # backend, web, shared-types
pnpm --filter backend test:fake            # fake-mode acceptance per milestone (DATA_STORE=memory, no Docker)
pnpm --filter backend test:int             # Testcontainers: Postgres/PostGIS + Redis + Typesense (needs Docker)
pnpm --filter web e2e                      # console e2e (Playwright) on a production build against the fake backend
pnpm openapi:gen                           # regenerate OpenAPI → shared-types / santha_api (CI fails if stale)
melos run analyze && melos run test        # Flutter
melos run golden:update                    # regenerate santha_ui + consumer Home goldens (on Linux, to match CI)
```
Goldens are compared on Linux only (CI); on Windows/macOS they are skipped because font anti-aliasing differs.

## Decisions
See `docs/decisions/` (ADR-001 stack, ADR-002 web hosting, ADR-003 local object storage, ADR-004 separate apps,
ADR-005 in-memory fake mode, ADR-006 M1 scope, ADR-007 ops console session & maps, ADR-008 M2 catalogue & search, ADR-009 M3 consumer discovery).
