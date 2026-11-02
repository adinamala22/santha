# Performance budgets

Budgets come from PRD §8 (non-functional) and Tech plan §6.2. Each one has a place where it is measured.
A release that misses a budget on staging does not ship, unless the on-call lead accepts it in the launch checklist.

| What | Budget | Measured by |
|---|---|---|
| Home feed API | p95 ≤ 1.2 s | k6 `feed` scenario (`infra/k6/peak.js`); Grafana `http_server_duration{route="/v1/feed"}` |
| Search API | p95 ≤ 400 ms; zero-result rate ≤ 8 % | k6 `search`; PostHog `search_performed.zero_result` |
| Order placement, end to end | p95 ≤ 3 s | k6 `order_place_ms`; `orders.place` span |
| Merchant order alert | p95 ≤ 5 s from `order.placed` | notification log latency (M5) |
| Dispatch assignment | p90 ≤ 3 min | dispatch metrics (M6) |
| App cold start, consumer | ≤ 2.5 s on a ₹10–15k Android (Redmi 12C class) | `flutter run --profile --trace-startup` on the device; Firebase Performance `_app_start` |
| Scroll jank, feed and store pages | < 1 % of frames over 16 ms | Flutter DevTools frame chart, profile build |
| Landing site | Lighthouse ≥ 90 on Performance, Accessibility, Best practices and SEO (mobile) | `pnpm dlx @lhci/cli autorun` against the staging site |
| Availability | 99.9 % monthly for order placement and merchant alerts | Grafana SLO board |
| Crash-free sessions | ≥ 99.5 % | Crashlytics |
| Load | 5 × pilot peak = 600 orders/hour, with 30-minute lunch and dinner spikes | `k6 run -e DURATION=30m infra/k6/peak.js` |

## How the budgets are kept
- **Backend.**
  - The feed and search responses are cached per micro-market for 30 s (M3).
  - Search goes to Typesense with geo filters, never to Postgres `LIKE` (M2).
  - Order placement does one transaction with the outbox write; notifications and dispatch run after commit (M4–M6).
- **Apps.**
  - The feed and store pages are shown from the offline cache first (ADR-009).
  - Images go through the CDN at the size the screen needs.
  - Fonts are bundled, so first paint does not wait on the network.
- **Web.**
  - The landing pages are static and server-rendered, with no client JavaScript beyond the lead form.
  - Mockup images are lazy-loaded with fixed dimensions to avoid layout shift.
  - Security headers are set without a blocking script.

## Running locally
`pnpm dev:fake`, then `k6 run infra/k6/peak.js`. In-memory latencies are far below staging, so the
local run checks that the scripts and flows work. Only a staging run shows whether the budgets hold.
