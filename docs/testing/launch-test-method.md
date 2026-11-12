# How the launch tests were run

This page explains the method. The results, scenario by scenario with screenshots, are in
[launch-test-report.md](launch-test-report.md).

## Where
| Target | Address | What it is |
|---|---|---|
| Fake | `http://localhost:4000` + `http://localhost:3000` | In-memory backend with demo data and a production build of the website. Fast; every spec runs. |
| QA (live) | `https://api.test.santhaapp.com`, `https://test.santhaapp.com` | The real QA server: Postgres, Redis, Typesense, background jobs, the real OTP rate limits. Only live-safe specs run (fresh users, cash on delivery, settings put back). |
| Emulator | Android 35 emulator `santha_pixel` | The three real apps (QA flavor, "Santha Test", "Santha Partner Test", "Santha Rider Test") talking to QA. |

## Who (several logins at once)
| Role | Login | Used for |
|---|---|---|
| Customers A, B, C | a fresh phone each run (`9` + 9 digits) or `9100000001` to `9100000003` on the emulator, OTP `123456` on QA | ordering, cancelling, rating, tipping; proving customers cannot see each other |
| Store owner | `9000000201` (Ramesh Stores) and `9000000202` (second store) | accepting, rejecting, handing over; proving a store cannot touch another store's order |
| Riders | `9000000101`, `9000000102` | offers, first-to-accept, delivery, profile, earnings |
| Ops | the QA ops user (email, password, then the code) | the console: every section, order page, Telugu, refusals |

## How
1. **API scenarios** (`apps/web/e2e/features/launch-campaign.spec.ts`, ids `LC-nn`): Playwright's request client plays
   the apps. Each scenario signs in as several people, acts, and asserts what each person can and cannot see or do.
   Run on fake: `pnpm --filter web e2e features/launch-campaign`. Run on QA:
   `E2E_TARGET=live E2E_API_URL=https://api.test.santhaapp.com pnpm --filter web e2e:live features/launch-campaign`.
2. **Console and public site** (`launch-screenshots.spec.ts`): a real Chrome signs in to the ops console, opens every
   section, and saves a PNG of each page. Public pages are shot in English, Telugu, and at phone width (390 px), and
   the test also fails if a page scrolls sideways or shows an error. Screenshots land in
   `docs/testing/screenshots/web/` when `E2E_SHOTS_DIR` is set:
   `E2E_SHOTS_DIR=../../docs/testing/screenshots/web pnpm --filter web e2e:live features/launch-screenshots`.
3. **Apps on the emulator**: `adb` starts the app, `D:\dev\scripts\ui.mjs` finds each button by its visible text
   (through `uiautomator dump`) and taps it, types the phone and the code, and `adb exec-out screencap -p` saves each
   screen to `docs/testing/screenshots/apps/`. Every step is a named screenshot, so a failure shows where it stopped.
4. **Existing suites** stay the safety net and were run too: backend unit and fake-mode acceptance tests, Flutter
   tests, and the other Playwright specs.

## What "pass" means
A scenario passes only if every assertion holds: the right status codes (401 not signed in, 403 wrong role, 404 not
yours, 409 wrong state, 400 bad input), the right data for each person, and nothing left changed afterwards.
