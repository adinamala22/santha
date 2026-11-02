# web

Next.js 15 (App Router) — landing site and ops console. Conventions: `.claude/skills/santha-web/SKILL.md`.

- `/` — placeholder landing (hero, how it works, footer) in English + Telugu. Full site in M8.
- `/admin/login` — ops sign-in (`design/mockups/admin-login-desktop.png`): email + password, then OTP to the account
  phone. Local: `admin@santha.local` / `santha-admin-dev`, OTP `123456`.
- `/admin` — overview: review queue, live merchants, micro-markets (live orders join when ordering exists).
- `/admin/merchants` — onboarding queue (oldest submission first), merchant review with KYC results, onboarding
  steps, approve / send back with a reason / go live (each with a confirm step), history.
- `/admin/micro-markets` — all areas on a map; per market: version history (incl. scheduled versions) and an editor
  that publishes a new version (polygon on the map, fees, COD, SLAs, rider pay, hours, start time, note).
- `/admin/audit` — every ops action, newest first.

Sessions (ADR-007): route handlers under `/api/ops/*` keep tokens in httpOnly cookies; `src/middleware.ts` guards
`/admin` and refreshes expired access tokens; pages and server actions call the backend via `src/lib/ops/server.ts`.
The backend enforces roles; the UI hides actions a role cannot take.

Design tokens come from `design/tokens/` only: Tailwind spreads `tailwind.tokens.js`; `scripts/sync-brand.mjs` copies
`tokens.css` and logos into the app before dev/build/test (outputs are git-ignored). Hex colours in code fail lint.
Copy: `src/i18n/messages.ts` (site + sign-in) and `src/i18n/console.ts` (console), both en + te with parity tests.

```bash
pnpm dev:fake                          # (repo root) fake backend :4000 + web :3000, no Docker
pnpm --filter web test                 # Vitest + Testing Library
pnpm --filter web e2e                  # Playwright console flows against the fake backend (starts servers if needed)
PW_CHANNEL=chrome pnpm --filter web e2e  # use the installed Chrome instead of Playwright's Chromium
pnpm --filter web build                # NEXT_STANDALONE=1 for the container image (ADR-002)
```
The fake store resets when the backend restarts; restart it before re-running e2e locally (CI always starts fresh).

M4: `/admin/promos` lists promo codes with budget usage, creates codes (admin, finance) and pauses/resumes them (admin, ops, finance); every change is audited.

M5: `/admin/orders` lists orders with state filters and counts; `/admin/orders/[id]` shows line changes, refunds, the transition timeline with actors, payment and every message sent (comms log).
