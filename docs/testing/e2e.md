# End-to-end tests (Playwright)

One suite in `apps/web/e2e`, two targets.

| Target | Command | Runs | When |
|---|---|---|---|
| **fake** | `pnpm --filter web e2e` | every spec, against the in-memory backend + a production web build (both started by `playwright.config.ts`) | CI on every PR (`web.yml` → "console e2e") |
| **live** | `pnpm --filter web e2e:live` (`e2e:live:watch` opens the browser) | `smoke/`, `journeys/`, `features/` against https://test.santhaapp.com | automatically after every successful deploy to test (`live-e2e.yml`), or by hand (Actions → live e2e → Run workflow) |

## Layout
- `e2e/support/target.ts`: target switch, API helpers (OTP sign-in with `123456`, COD order, self-delivery, ops sign-in), demo-data ids.
- `e2e/smoke/`: the API is ready; the public site, store link page and console load.
- `e2e/journeys/`: whole flows through the API as the consumer, partner and rider apps drive them (order → delivery → rating, rider dispatch). They run on both targets.
- `e2e/features/`: one file per feature (UI + API), e.g. `service-coverage.spec.ts`.
- `e2e/*.spec.ts` (older console specs): fake only, because they depend on fresh demo data (approve a submitted merchant, clock control, mock payments).

## Rules for live-safe specs
- Use a fresh customer per run (`newCustomer`), pay COD (test uses the Razorpay sandbox, not the mock sheet).
- Put back every setting you change (store hours, radius, city coverage) in `finally` / `afterAll`.
- Don't depend on cached pages (store link pages revalidate every 5 min) or exact counts that other runs change.

## Ops login on test
The live console specs sign in as the QA ops user. CI reads `E2E_OPS_EMAIL` / `E2E_OPS_PASSWORD` from the GitHub
environment `test`. Locally, put them in `apps/web/.env.e2e.local` (git-ignored) or export them. Without them the console specs are skipped.

## Keeping it current
Every feature or bug fix adds or updates a spec here in the same PR (CLAUDE.md, Definition of done):
a `features/<feature>.spec.ts` for the new behaviour, plus a step in a `journeys/` spec if it changes a core flow.
The Flutter apps are also checked on the Android emulator against test (`D:\dev\scripts\ui.mjs` locally).
