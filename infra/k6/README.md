# Load tests (k6)

`peak.js` runs the pilot peak × 5 (Tech plan §6.2: 600 orders/hour) as three concurrent scenarios:
- feed browsing at 100/min;
- search at 60/min;
- cash-on-delivery checkout at 10/min.

Its thresholds are the budgets in `docs/performance-budgets.md`, so k6 exits non-zero when one is missed.

```sh
pnpm dev:fake                       # or point BASE at staging
k6 run infra/k6/peak.js             # 10 minutes; -e DURATION=30m for the lunch-spike soak
k6 run -e BASE=https://api.staging.santha.in/v1 -e OTP=<staging dev code> infra/k6/peak.js
```

- Never run it against production.
- On staging, check that the store being tested (`MERCHANT_ID`) is open and its first item is in stock.
- Afterwards, cancel or expire the test orders: an unaccepted order expires after the accept timer.
- Record each staging run, with its p95 values, in `docs/launch/launch-checklist.md`.
