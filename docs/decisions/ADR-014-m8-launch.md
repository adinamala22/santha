# ADR-014: M8 trust & safety, analytics, hardening and launch

2026-11-03 · Status: accepted

## Context
M8 (BUILD-PLAN) makes the product launch-ready. It covers:
- moderation, reviews with replies, and grievances;
- DPDP consent and data-principal rights;
- an analytics pipeline with business dashboards;
- performance and security hardening;
- the landing site and store link pages;
- the store listings and the launch pack;
- a closed beta.

The plan names ClickHouse and Metabase for analytics. It leaves open the legal clocks, the erasure
semantics, how much of the analytics stack the pilot needs, and how SAST and DAST run.

## Decision
- **Placement.**
  - Grievances, consents, data requests and review moderation live in `ComplianceService` in the
    existing `IssuesModule` (`trust-safety/`). They need orders, addresses and ratings, and that
    module already sits above them.
  - Leads and reports live in a `GrowthModule` (`analytics-config/growth/`), kept separate for the
    same cycle reason as ADR-013.
  - The public store API (`GET /v1/public/stores[/:slug]`) returns only the store's name, area,
    rating and hours. `Merchant.slug` is set at go-live from the name and an id suffix, and backfilled
    by the seed.
- **Legal clocks.**
  - Grievances are acknowledged within 48 h and resolved within 30 days (IT Rules 2021). Overdue is
    computed from the service clock, so DevClock tests can drive it.
  - A data access request is self-service: the JSON export is ready at once, and the app shows a summary.
  - Correction and erasure are completed by ops in the console with a note. Each writes an audit row.
- **Erasure means anonymisation, not deletion.**
  - The phone becomes `deleted:<id>`. Name and addresses are removed, and so are push tokens and the
    WhatsApp opt-in. Every session is revoked, and the account status becomes `deleted`, which `/v1/me` refuses.
  - The phone number is free again: signing in with it creates a new account.
  - Orders, payouts and tax records keep the user id, because GST record-keeping requires 8 years.
    This is stated in the privacy notice.
- **Consent ledger.**
  - Consents are append-only, one row per purpose and notice version.
  - The consumer login shows the notice. After sign-in the app records `terms` and `privacy` when no
    current consent exists (once per version).
  - `marketing` is opt-in in Privacy and help.
- **Reviews.**
  - `screenReview` is a keyword and pattern stub: phone numbers, abuse, links. Flagged reviews wait for
    ops (publish or hide). Clean ones are visible at once.
  - A store can reply once, publicly.
  - Image moderation keeps the M2 media QA queue. A classifier is a follow-up behind the same stub interface.
- **Analytics for the pilot.**
  - `GrowthService` exports a fixed allow-list of domain events (`EXPORTED_EVENTS`) to PostHog. The
    export carries ids, states and amounts only, never phones, names or addresses.
  - In fake mode, or without `POSTHOG_KEY`, events are buffered in memory (`GrowthService.captured`).
    The fake-mode tests assert that the buffer holds no phone numbers.
  - The business dashboards (funnel, on-time, fill rate, contribution per order, merchant health,
    rider utilisation) are computed in `domain/reports.ts` from the operational tables and shown at
    `/admin/reports`.
  - ClickHouse and Metabase are deferred. At ~700 orders a day (Tech plan §6.2) Postgres answers
    these queries in milliseconds, and a second store would add cost and a residency review. Add them
    when the reports outgrow Postgres or analysts need ad-hoc SQL. `refund.issued`, `issue.resolved`
    and `settlement.run_completed` (promised in ADR-013) become outbox events then. The reports read
    the same facts from the tables.
- **Hardening.**
  - Security headers on the API (CSP `default-src 'none'` except `/docs`; HSTS outside dev).
  - Security headers on the web (CSP with `'unsafe-inline'` scripts, which the App Router needs
    without nonces; frame-ancestors none, nosniff, HSTS in production).
  - The lead form has a honeypot, a rate limit of 5 per hour per hashed IP, and de-duplication by
    phone and kind.
  - SAST is CodeQL (`codeql.yml`, security-extended, on PRs and weekly). DAST is the ZAP baseline and
    API scans against the fake service (`zap.yml`, weekly and manual). The active scan and the external
    pen test run on staging before launch.
  - Load is tested with k6 at 5 × peak (`infra/k6/peak.js`), with the PRD budgets as thresholds
    (`docs/performance-budgets.md`).
- **OpenAPI nullability.** `common/zod-dto.ts` wraps `createZodDto` so that zod 4's
  `type: [T, 'null']` becomes `{type: T, nullable: true}`. Before this, every nullable top-level
  field was generated as `T[]` in `@santha/shared-types`.
- **Launch pack.** `docs/launch/` holds the checklist, beta plan, store listings (en/te), DPDP register,
  runbooks and on-call rota. Items that need a business, legal or provider action are left unticked.

## Consequences
- The pilot runs with no analytics infrastructure beyond PostHog, and every report is testable in fake mode.
- Some beta acceptance criteria are operational and cannot be met in the repository:
  - two weeks of on-time ≥ 85 %, fill ≥ 95 % and crash-free ≥ 99.5 %;
  - a staging Lighthouse run;
  - the pen-test report.
  They are tracked in `docs/launch/launch-checklist.md`.
- Follow-ups:
  - per-user session revoke for ops;
  - a one-click micro-market pause;
  - grievance and privacy screens in the merchant and rider apps (today they use `grievance@santha.in`);
  - an image classifier;
  - ClickHouse and Metabase when volume calls for them.
