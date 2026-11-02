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

## dispatch-tracking (M6)
| Endpoint | Auth | Notes |
|---|---|---|
| `GET /v1/riders/me` · `PUT /v1/riders/me/status` · `POST /v1/riders/me/location` · `GET /v1/riders/me/earnings` | rider | Home (open offer, jobs, today), online with zones, position every ~10 s (Redis GEO). |
| `POST /v1/offers/:id/accept` · `/decline` | rider | 30-s offers; 409 OFFER_EXPIRED. |
| `GET /v1/jobs/:id` · `POST /v1/jobs/:id/arrived` · `/picked-up` `{ pickupCode }` · `/delivered` `{ otp \| photoMediaId, codCollectedPaise? }` | rider | 422 WRONG_CODE, 409 NOT_READY. |
| `GET /v1/staff-jobs/:token` · `POST …/picked-up` · `…/delivered` · `…/location` | public (token) | Self-delivery link `/d/{token}` on the web. |
| `GET /v1/orders/:id/tracking` · `POST /v1/orders/:id/cancel-no-courier` | consumer | Courier, OTP, live location, ETA vs promise; cancel after the fallback ladder. |
| `GET /v1/merchants/me/deliveries` · `POST /v1/merchants/me/orders/:id/deliver-myself` · `GET /v1/merchants/me/statements/preview` | merchant | Pickup code, courier, staff link, fallback bonus; commission ladder preview. |
| `GET /v1/ops/live` · `POST /v1/ops/orders/:id/reassign` · `/force-self` | ops | Live board; overrides are audited. |

Accept takes `{ fulfilmentMode, staffId? }`. Dispatch starts from `order.accepted`; offers, retries and the
fallback ladder are timers on the `timers` queue (`fulfilment:{id}:offer|retry|fallback`). Providers: 3PL
(`THREEPL_PROVIDER=mock`, `MOCK_3PL_AVAILABLE`) and call masking are mocks only (ADR-012).

## settlement, refunds, issues (M7)
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /v1/orders/:id/issues` · `GET /v1/orders/:id/issues` · `POST /v1/orders/:id/rating` | consumer | Windows 2 h cooked / 24 h retail / 48 h fashion; decided at once (auto wallet refund or review). |
| `GET /v1/merchants/me/payouts` · `/payouts/:id` · `/payouts/:id/statement.pdf` · `.csv` | merchant | Nightly payouts with commission invoice, TCS, TDS. |
| `GET /v1/merchants/me/refunds` · `POST /v1/merchants/me/disputes` · `GET /v1/merchants/me/disputes` | merchant | Dispute refunds charged to the store within 48 h. |
| `GET /v1/riders/me/payouts` | rider | Weekly (or daily) payouts. |
| `GET /v1/ops/settlements` · `POST /v1/ops/settlements/run` · `GET …/:id/payouts(.csv)` · `POST /v1/ops/payouts/:id/retry` | admin, finance (ops read) | Idempotent per period. |
| `GET /v1/ops/refunds` · `POST …/:id/approve` · `…/:id/reject` | admin, ops, finance | Four-eyes above ₹1,000; ops capped at ₹2,000. |
| `GET /v1/ops/recon` · `POST /v1/ops/recon/run` · `…/:id/resolve` · `GET /v1/ops/disputes` · `POST …/:id/resolve` · `GET /v1/ops/issues` | ops / finance | Exceptions queue, disputes, issues with trust scores. |

Settlement runs hourly after 02:00 IST (timer `settlement.daily`). Seeded console users: admin@, finance@ and
ops@santha.local (dev password) so four-eyes can be tried locally (ADR-013).

## Commands
```bash
pnpm --filter backend dev            # watch mode (reads ../../.env)
pnpm --filter backend worker         # outbox relay + queue workers without HTTP
pnpm --filter backend test           # unit + HTTP tests (no Docker)
pnpm --filter backend test:int       # Testcontainers integration (Docker)
pnpm --filter backend migrate:dev    # create a migration after editing schema.prisma
pnpm --filter backend openapi:gen    # write openapi.json (+ copies for shared-types and santha_api)
```
