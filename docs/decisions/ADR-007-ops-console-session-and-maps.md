# ADR-007: Ops console session (route handlers + middleware, not NextAuth) and map tiles
2026-11-01 · Status: accepted

## Context
The santha-web skill suggested NextAuth (Credentials) for the ops console. The backend already does everything
NextAuth would: email + password, OTP second factor, short-lived access JWT, rotating device-bound refresh token
(8 h for `web_admin`), roles in claims. The console needs a polygon editor for micro-markets.

## Decision
- **No NextAuth.** Three Next.js route handlers (`/api/ops/login`, `/api/ops/verify`, `/api/ops/logout`) call the
  backend and keep the access token, refresh token and a per-browser device id in **httpOnly, SameSite=Lax**
  cookies (Secure in production). Tokens never reach browser JavaScript. `middleware.ts` guards `/admin/*`:
  a valid access token passes; an expired one is refreshed with the refresh cookie (the rotated tokens are set on
  the response and forwarded to that request); otherwise the user goes to `/admin/login?next=…`. Server
  components and server actions call the backend with the cookies (`lib/ops/server.ts`). Authorisation stays in
  the backend (`@Roles`); the UI only hides actions a role cannot take.
- **Maps**: MapLibre GL with raster tiles from `NEXT_PUBLIC_MAP_TILES_URL`, defaulting to OpenStreetMap — fine for
  low-volume internal use. Production points it at Google Maps tiles or MapTiler, as the skill suggests.
- **Console language**: English by default with a Telugu switch (cookie `santha_ops_lang`); all console copy is
  in `src/i18n/console.ts` with an en/te parity test.

## Consequences / when to revisit
Fewer dependencies and one source of truth for sessions. CSRF exposure is limited to same-site POSTs (SameSite=Lax
plus server actions' origin check). Revisit if the console needs SSO (Google Workspace) — NextAuth or the backend
would then add an OIDC flow.
