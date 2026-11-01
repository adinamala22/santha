# backend

NestJS modular monolith. Conventions: `.claude/skills/santha-backend/SKILL.md`, rules: `santha-architecture`.

```
src/
  main.ts · worker.ts · app.module.ts · app.factory.ts (prefix /v1, CORS, Swagger at /docs)
  config/          zod-validated env (process refuses to start on bad config)
  common/          errors (DomainError → { error: { code, message, details, requestId } }), auth decorators, PII helpers, clock
  infra/           prisma (+ PostGIS helpers in geo.ts), redis, queues (BullMQ), outbox (writer, relay, event bus, worker), providers/sms
  health/          GET /v1/health (liveness) · GET /v1/health/ready (Postgres+PostGIS, Redis)
  modules/         the ten modules; identity-kyc is implemented, the rest are scaffolds
prisma/            schema.prisma · migrations/ · seed.ts
test/              e2e (HTTP, in-memory) · integration (Testcontainers) · mocks
```

## identity-kyc (M0)
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /v1/auth/otp/request` | public | `{ phone, deviceId, app, locale? }` → `{ challengeId, expiresInSec, resendAfterSec }`. Rate-limited per phone/device/IP (Redis) + resend cooldown. |
| `POST /v1/auth/otp/verify` | public | `{ challengeId, code, deviceId, app, platform, appVersion? }` → tokens + user. Creates the user on first sign-in and grants the app's role (consumer/merchant/rider; ops roles are never self-granted). Emits `user.registered`, `user.role_granted` via the outbox. |
| `POST /v1/auth/refresh` | public | Rotating refresh token, bound to the device; replaying an old token revokes the session. |
| `POST /v1/auth/logout` | bearer | Revokes the session. |
| `GET /v1/me` | bearer | Masked phone, roles. |

Every authenticated request must send `X-Device-Id` matching the token. Use `@Public()` and `@Roles(...)` from
`common/auth/decorators.ts` on new routes (the guard is global).

## Commands
```bash
pnpm --filter backend dev            # watch mode (reads ../../.env)
pnpm --filter backend worker         # outbox relay + queue workers without HTTP
pnpm --filter backend test           # unit + HTTP tests (no Docker)
pnpm --filter backend test:int       # Testcontainers integration (Docker)
pnpm --filter backend migrate:dev    # create a migration after editing schema.prisma
pnpm --filter backend openapi:gen    # write openapi.json (+ copies for shared-types and santha_api)
```
