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

## orders lifecycle (M5)
| Endpoint | Auth | Notes |
|---|---|---|
| `GET /v1/merchants/me/orders?bucket=new\|preparing\|ready\|out\|done` | merchant | Board with counts per bucket and today's summary. Address only after accept. |
| `POST /v1/orders/:id/accept` · `/reject` · `/ready` | merchant | Guarded transitions; 409 INVALID_STATE when the order moved on. Reject reasons: out_of_stock, store_closing, too_busy, cannot_deliver, other. |
| `POST /v1/orders/:id/items/:variantId/unavailable` | merchant | `{ action: remove }` or `{ action: substitute, itemId, variantId }` (same price or less); the difference goes to the wallet at once. |
| `PUT /v1/merchants/me/availability` | merchant | `{ open }`. Two missed orders auto-pause the store. |
| `POST /v1/orders/:id/cancel` | consumer | Free while PLACED only. |
| `PUT /v1/me/push-token` · `GET/PUT /v1/me/notification-preferences` | bearer | FCM token; WhatsApp opt-in. |
| `GET /v1/ops/orders` · `GET /v1/ops/orders/:id` | ops | List; detail with timeline and comms log. |

Realtime: Socket.IO at path `/v1/realtime`, `auth: { token, deviceId }`, events `order.new`, `order.updated`,
`store.paused`. Timers (accept window, SMS/call reminders) are BullMQ delayed jobs on the `timers` queue. In fake
mode, `POST /v1/dev/jobs/timers` fires the ones due at the dev clock (ADR-011).

## Commands
```bash
pnpm --filter backend dev            # watch mode (reads ../../.env)
pnpm --filter backend worker         # outbox relay + queue workers without HTTP
pnpm --filter backend test           # unit + HTTP tests (no Docker)
pnpm --filter backend test:int       # Testcontainers integration (Docker)
pnpm --filter backend migrate:dev    # create a migration after editing schema.prisma
pnpm --filter backend openapi:gen    # write openapi.json (+ copies for shared-types and santha_api)
```
