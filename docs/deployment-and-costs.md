# Santha — Budget deployment and third-party cost plan (M0 → M8)

**Purpose.** What Santha needs to run in production at each milestone, the **free or lowest-cost** option for each
need, and what it costs. Use it to plan accounts, paperwork and monthly spend from the first staging server to the
closed beta in M8.

**Status.** Draft for decision, 2026-11-02. The architecture skill and ADR-001 assume AWS Mumbai. This document
proposes starting on a budget provider and moving to AWS when volume justifies it. If adopted, record it as
**ADR-010 (Pilot hosting on a budget provider, AWS later)**.

> **Prices are approximate**, from public price lists as known in 2026, converted at about **₹85 = $1**, and exclude
> GST (18%) unless noted. Free tiers and prices change often. Check each vendor's current page before signing up.

---

## 1. Ground rules that shape every choice

1. **India data residency is mandatory** (CLAUDE.md, DPDP Act). Personal data — phone numbers, addresses, KYC
   documents, orders, locations, payments — must be stored in India. So databases, file storage and servers must be
   in an Indian region (Mumbai, Bangalore, Hyderabad, Delhi, Chennai).
2. Tools hosted outside India (Sentry, Grafana Cloud, PostHog Cloud, Cloudflare CDN) may only receive **non-personal
   or pseudonymous data**: user IDs, never phone numbers, names or addresses. Product photos and the public landing
   site are not personal data and can be cached anywhere.
3. **Never call live payment, KYC or SMS providers from dev/test** — use sandboxes and the mocks already in the code.
4. The code is already **portable**: every storage, search, SMS, KYC, maps and payment dependency sits behind a port
   with a mock. Moving from a budget host to AWS later is configuration, not a rewrite.

---

## 2. Recommended setup in one page

| Environment | Where | Approx. cost / month |
|---|---|---|
| **Local dev** | Your laptop: `pnpm dev:fake` (no Docker) or `docker compose up -d` | ₹0 |
| **Staging** (M0–M7) | **Oracle Cloud Always Free**, Hyderabad or Mumbai: one ARM VM running everything in Docker Compose | **₹0** |
| **Production / beta** (from M4–M8) | **DigitalOcean Bangalore** (or E2E Networks / Vultr India): one app server + managed Postgres + object storage | **≈ ₹5,500 – 9,000** |
| **Scale-up** (after launch, multiple micro-markets) | AWS Mumbai as in the architecture skill | ₹40,000 – 80,000+ |

Third-party tools at beta scale (30 merchants, 300 users, 10 riders) stay mostly on free tiers. Expect **≈ ₹2,000 –
6,000 / month** on top of hosting once payments, masked calling and SMS fallback are live, **plus ~2% of online
payment value** to the payment gateway.

---

## 3. Hosting options compared

### Option A — Oracle Cloud "Always Free" (staging, early pilot): ₹0

- **What you get (free for good):** ARM (Ampere A1) compute up to **4 cores / 24 GB RAM**, 200 GB block storage,
  20 GB object storage, 10 TB/month outbound, in the region you pick at sign-up (choose **Hyderabad or Mumbai**;
  the home region cannot be changed later).
- **How Santha runs on it:** one VM with Docker Compose — Postgres 16 + PostGIS, Redis 7, Typesense, RustFS (S3-
  compatible photo storage), API, worker, Next.js web, and **Caddy** for automatic HTTPS. Nightly `pg_dump` to Oracle
  object storage.
- **Watch out for:**
  - Single server, no managed database: backups and upgrades are on you.
  - "Out of capacity" errors when creating ARM VMs in popular regions (retry, or start smaller).
  - Oracle may reclaim **idle** free instances; a pilot with real traffic is not idle, but keep an eye on emails.
  - ARM images: Postgres/PostGIS, Redis, Node and Caddy publish ARM builds; confirm Typesense and RustFS tags.
  - A card is needed at sign-up (verification only).

### Option B — DigitalOcean Bangalore (budget production): ≈ ₹5,500 – 9,000

| Item | Plan | $/month | ₹/month |
|---|---|---|---|
| App server (API, worker, Typesense, Redis, Next.js, Caddy) | Droplet 2 vCPU / 4 GB | 24 | 2,050 |
| Managed PostgreSQL 16 (PostGIS, daily backups, point-in-time restore) | 1 vCPU / 2 GB | 30 | 2,550 |
| Spaces object storage + CDN (photos, invoices, KYC files) | 250 GB included | 5 | 425 |
| Droplet backups | weekly snapshots | 5 | 425 |
| **Start total** | | **64** | **≈ 5,450** |
| *At M6–M8:* second droplet for workers / WebSockets, bigger DB | 2 vCPU / 4 GB + DB 2 vCPU / 4 GB | +24 / +30 | +4,600 → **≈ 10,000** |

Equivalent Indian-region choices (compare before choosing):
- **E2E Networks** (Indian company, Delhi/Mumbai): often cheapest, **billed in rupees with GST invoices** (input
  credit for your company). Managed DB and object storage available.
- **Vultr** (Mumbai, Bangalore, Delhi): similar to DigitalOcean.
- **Supabase Pro** (Mumbai, about $25 / ₹2,100): managed Postgres with PostGIS, if you prefer managed DB + a cheap VM.
- **Hetzner** is cheaper still but has **no Indian region**, so it fails the residency rule.

### Option C — AWS Mumbai (scale): ₹40,000 – 80,000+

RDS Multi-AZ + ElastiCache + ECS Fargate + S3/CloudFront + WAF, as in the architecture and devops skills. Move here
when you run several micro-markets, need multi-AZ uptime, or a partner/investor requires it. **AWS Activate**
startup credits (from a few thousand to tens of thousands of dollars, through accelerators/VCs) can make this free for
a year — worth applying for once the company is incorporated.

---

## 4. Third-party services, milestone by milestone

Each row: what it's for, the **free / cheapest** choice, the paid upgrade, and the estimate at beta scale.

### M0 — Foundations: sign-in, CI

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| Source code + CI | **GitHub Free** (2,000 Actions minutes/month on private repos; unlimited on public) | GitHub Team $4/user | ₹0 (CI may exceed 2,000 min — see §6) |
| **OTP login (SMS)** | **MSG91** or **Fast2SMS** pay-as-you-go, ~₹0.20–0.25 per SMS | Volume pricing | ₹200–600 (1,000–2,500 OTPs; sessions last 30 days, so logins are rare) |
| DLT registration (legally required for business SMS in India) | One operator's DLT portal (Jio, Airtel, Vi, BSNL); register entity, sender ID `SANTHA`, en + te templates | — | **₹0 – 6,000 one-time** (operator-dependent) |
| Cheaper OTP channel | **WhatsApp OTP via Meta Cloud API** (authentication template), ~₹0.11–0.15 per message; SMS as fallback | — | Halves OTP cost |
| Domain | `.in` (~₹600/yr) or `.app` (~₹1,500/yr); DNS on **Cloudflare free** | — | ~₹100/month |
| HTTPS certificates | **Let's Encrypt** via Caddy | — | ₹0 |
| Secrets | `.env` on the server, readable only by the app user; GitHub encrypted secrets for CI | Doppler free / AWS Secrets Manager | ₹0 |

**Code still to do:** the MSG91 provider is a stub (`apps/backend/src/infra/providers/sms/sms.provider.ts`).
WhatsApp OTP would be a new provider behind the same port.

### M1 — Micro-markets, merchants, KYC

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| **Merchant KYC** (PAN, Aadhaar, GSTIN, FSSAI, bank) | **Manual review by ops** in the console (already built): merchant uploads documents, ops checks them against government lookups (GST portal, FoSCoS for FSSAI) | **Cashfree Verification Suite** or **Setu** pay-per-check (lower minimums); **Digio/Signzy** for scale | ₹0 for 30–100 merchants. Paid: ~₹15–25 per merchant (PAN ~₹2–5, Aadhaar OKYC ~₹5–15, GSTIN ~₹1–3, penny-drop ~₹1.5–3). Check prepaid minimums (often ₹5,000–25,000). |
| Bank account check | Ops verifies a cancelled cheque / bank statement | Razorpay or Cashfree penny-drop (~₹2–3) | ₹0 |
| Ops console map (micro-market polygons) | **OpenStreetMap tiles** are fine for a handful of ops users (ADR-007) | MapTiler / Ola Maps | ₹0 |
| Ops email (OTP second factor, alerts) | **Brevo** free (300 emails/day) or **Resend** free (3,000/month) | Paid tier | ₹0 |

**Code still to do:** the Digio provider is a stub; add a **`manual` KYC provider** (production refuses `mock`).

### M2 — Catalogue, search, photos

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| Search | **Typesense self-hosted** on the app server (20k items needs < 1 GB RAM) | Typesense Cloud | ₹0 |
| Photo storage | RustFS on the VM (Option A) / **DO Spaces** (Option B) | S3 | ₹0 – 425 |
| Photo CDN | **Cloudflare free** in front of storage (product photos are public, non-personal) | — | ₹0 |
| Barcode master data | **Open Food Facts** (free, open licence) + merchants/ops entering missing products | Licensed GS1 India / commercial FMCG dataset (quote-based) | ₹0 |
| Delivery time (ETA) | **Google Routes API** free monthly allowance (~10,000 requests); results cached per area | Paid per 1,000 requests | ₹0 |

### M3 — Consumer discovery

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| Map in the consumer app (pin drop) | **Google Maps SDK for Android/iOS** (mobile map display is free) or **Ola Maps** free tier | — | ₹0 |
| Address search / geocoding | **Ola Maps** free tier, or Google Geocoding free allowance | Paid | ₹0 |
| Crash reporting | **Firebase Crashlytics** | — | ₹0 |
| Product analytics + feature flags | **PostHog Cloud free** (1M events/month, flags included). Send only pseudonymous user IDs (§1). | PostHog self-host in India | ₹0 |
| App stores | **Google Play** ₹2,100 one-time. **Apple** ₹8,500/year — postpone until iOS is ready. | — | one-time |

**Code still to do:** replace OpenStreetMap tiles in the consumer map pin with Google/Ola tiles before launch
(OSM's tile servers don't allow production apps).

### M4 — Cart, pricing, payments, orders

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| **Online payments** (UPI, cards) | **Razorpay** or **Cashfree**: no setup or annual fee, ~**2% per transaction** (UPI often lower; check current offers) | Negotiate at volume | 2% of online GMV. E.g. ₹3 lakh/month online → ~₹6,000 |
| Cash on delivery | Built in (rules in M4) | — | ₹0 |
| Sandbox for staging | Razorpay test mode | — | ₹0 |

Start Razorpay/Cashfree **business onboarding early**: it needs company PAN, bank account, website with policies
(terms, refunds, privacy, contact) and can take 1–3 weeks.

### M5 — Order lifecycle, merchant alerts

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| Push notifications (new order ringing, status) | **Firebase Cloud Messaging** (free, unlimited) | — | ₹0 |
| SMS fallback | Same MSG91 account (transactional templates via DLT) | — | ₹200–800 |
| WhatsApp updates (opt-in) | **Meta WhatsApp Cloud API directly** (no BSP margin). Utility messages cost paise each; service replies within 24 h are free | Gupshup / Interakt dashboards | ₹200–1,000 |
| Voice-call fallback for missed merchant alerts | **Exotel** or **Knowlarity** pay-as-you-go | — | Bundle with masking below |
| Real-time updates (WebSockets) | Socket.IO on the app server | Separate WS server (M6+) | ₹0 |

### M6 — Hybrid fulfilment, rider app, tracking

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| **Masked calling** (customer ↔ merchant/rider; required by CLAUDE.md) | **Exotel** (most common in India); compare **Knowlarity**, **MyOperator** | — | **≈ ₹2,000 – 5,000/month** (plan + per-minute). The hardest cost to avoid. |
| Low-cost alternative during beta | In-app "call" goes through Exotel only for live orders; numbers expire on delivery | — | Keeps minutes low |
| Rider navigation | Hand-off to **Google Maps app** (free) | — | ₹0 |
| Rider live location | Redis GEO + WebSockets on your server | — | ₹0 |
| 3PL fallback (when no rider) | **Porter / Shadowfax / Dunzo-style APIs** — pay per delivery, no monthly fee; or manual booking by ops in beta | API integration | per delivery only |
| Live orders map in console | OSM tiles for ops (few users) | MapTiler / Ola | ₹0 |

### M7 — Settlements, refunds, invoices, issues

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| Merchant & rider payouts | **Razorpay Route / RazorpayX** or **Cashfree Payouts**: per-transfer fee (~₹2–5 each via IMPS/NEFT/UPI) | — | 30 merchants daily + 10 riders weekly ≈ 1,000 transfers → ₹2,000–5,000. **Cheaper:** weekly merchant payouts in beta (~₹500) |
| GST invoices / credit notes (PDF) | Generated by the backend, stored in your India object storage | — | ₹0 |
| E-invoicing (IRN) | Only required above the turnover threshold (₹5 crore currently); not needed for the pilot | GSP integration | ₹0 |
| Accounting | **Zoho Books** free plan (small turnover) or Tally | Paid plan | ₹0 |
| Reconciliation | Backend job against gateway settlement reports (API, free) | — | ₹0 |

### M8 — Trust & safety, analytics, hardening, landing, beta

| Need | Free / cheapest choice | Upgrade later | Beta-scale cost |
|---|---|---|---|
| Image/text moderation | Keyword rules (built in M2) + manual ops queue; classifier stub | Google Cloud Vision SafeSearch (free first 1,000 units/month) | ₹0 |
| Analytics warehouse | **Postgres read replica or nightly copy + Metabase (open source, self-hosted)** — skip ClickHouse until data is large | ClickHouse (self-host) / ClickHouse Cloud | ₹0 (runs on the app server or a ₹1,000/month droplet) |
| Dashboards | **Metabase open source** | Metabase Cloud | ₹0 |
| Error tracking | **Sentry free** (5,000 errors/month), with PII scrubbing on | Sentry Team $26 | ₹0 |
| Logs, metrics, traces | **Grafana Cloud free** (logs/metrics/traces within generous limits) via OpenTelemetry | Paid / self-host Loki+Prometheus | ₹0 |
| Uptime monitoring | **UptimeRobot** or **Better Stack** free | — | ₹0 |
| Load testing (k6) | **k6 open source**, run from a laptop or a temporary droplet | Grafana k6 Cloud | ₹0 – 200 |
| Security scanning (SAST/DAST) | **GitHub CodeQL** (free on public repos), **Semgrep** free, **OWASP ZAP**, **Trivy**, Dependabot | Snyk | ₹0 |
| Penetration test | Self-run ZAP + checklist for beta | Professional pen-test before public launch (₹50,000 – 2,00,000 one-time; CERT-In empanelled auditors if a partner requires it) | — |
| Landing site + store pages | Next.js on your server, or **Cloudflare Pages** free for the static landing (no personal data) | — | ₹0 |
| Lead forms | Store in your own DB (personal data stays in India) | — | ₹0 |
| Grievance officer / DPDP consent | Built into the backend; officer contact is a person, not a tool | — | ₹0 |
| Beta distribution | **Google Play internal / closed testing** (free, up to 100 / unlimited testers) | — | ₹0 |
| Status page | **Better Stack** / **Instatus** free | — | ₹0 |

---

## 5. Cost summary by phase

Assumptions: one micro-market in Nellore; beta in M8 with 30 merchants, 300 users, 10 riders; ~1,000–1,500 orders a
month by the end of beta, ~60% paid online at ~₹300 average.

### Monthly running cost

| Phase | Hosting | Third-party tools | Payment gateway fees | **Total / month** |
|---|---|---|---|---|
| **M0–M3** (dev + staging, no real users) | ₹0 (Oracle free) | ₹0–500 (test SMS) | — | **≈ ₹0 – 500** |
| **M4–M5** (staging with sandboxes; internal testing) | ₹0 staging (+ ₹5,450 if production is set up early) | ₹500–1,500 (SMS, WhatsApp) | sandbox, ₹0 | **≈ ₹500 – 7,000** |
| **M6–M7** (riders, masked calls, payouts on staging/live tests) | ₹5,450 – 10,000 | ₹3,000 – 7,000 (masking, SMS, payouts) | small | **≈ ₹8,500 – 17,000** |
| **M8 closed beta** (real money, real users) | ₹7,000 – 10,000 (prod) + ₹0 (staging) | ₹3,000 – 8,000 | ~₹4,000 – 6,000 | **≈ ₹14,000 – 24,000** |

### One-time costs

| Item | Cost | When |
|---|---|---|
| DLT registration (SMS sender ID + templates) | ₹0 – 6,000 | Before M0 goes live (start now) |
| Google Play developer account | ₹2,100 | Before beta builds |
| Domain (1st year) | ₹600 – 1,500 | Now |
| Apple developer account (optional until iOS) | ₹8,500 / year | When iOS ships |
| KYC provider prepaid minimum (only if not doing manual KYC) | ₹5,000 – 25,000 | M1+ |
| Trademark filing "Santha" (recommended, not technical) | ~₹4,500 – 9,000 per class | Any time |
| Professional pen-test (optional before public launch) | ₹50,000 – 2,00,000 | After M8 beta |
| **Minimum to reach beta** | **≈ ₹3,000 – 10,000** | |

### What the same setup costs on AWS (for comparison)

RDS Multi-AZ db.t4g.medium (~₹12,000) + ElastiCache (~₹4,000) + ECS Fargate 3–4 tasks (~₹10,000–15,000) + ALB
(~₹2,000) + NAT gateway (~₹3,500) + WAF (~₹1,000) + S3/CloudFront/Secrets/CloudWatch (~₹2,000–4,000) ≈ **₹35,000 –
45,000 a month** before traffic, i.e. 5–8× Option B. Worth it later for uptime and managed scaling, not for a pilot.

---

## 6. Free-tier limits to watch

| Service | Free limit (approx.) | What to do when you hit it |
|---|---|---|
| GitHub Actions (private repo) | 2,000 min/month | Current CI (6 jobs per push) uses ~10–12 min per run → ~150 runs/month. Run integration/e2e only on PRs to main, or use a **self-hosted runner** on the staging VM (free). |
| Oracle Always Free | 4 OCPU / 24 GB ARM, 200 GB disk | Move production to Option B; keep Oracle for staging. |
| Google Maps Platform | Monthly free calls per API (~10,000 for most Essentials APIs) | ETA cache per H3 cell keeps usage low; set **budget alerts and quotas** in Google Cloud Console. |
| Firebase (Spark plan) | FCM and Crashlytics free and unlimited | — |
| PostHog | 1M events/month | Sample low-value events; or self-host. |
| Sentry | 5,000 errors/month | Filter noisy errors; upgrade if needed. |
| Grafana Cloud | Free tier quotas on logs/metrics/traces | Lower log level in production; drop debug traces. |
| Brevo / Resend | 300/day / 3,000/month emails | Enough for ops mail. |
| Cloudflare | Free plan, unlimited CDN bandwidth for cacheable assets | — |
| Meta WhatsApp Cloud API | Service conversations (user-initiated, 24 h) free; templates charged per message | Use templates only for order updates the user opted into. |

---

## 7. Accounts and paperwork checklist (start now — these are slow)

Most of these need an incorporated company (PAN, bank account, GST registration if applicable) and a live website
with Terms, Privacy, Refund and Contact pages.

| # | Account / registration | Needed by | Typical lead time |
|---|---|---|---|
| 1 | Company documents, current account, GST (if turnover/state rules require) | Everything below | 1–4 weeks |
| 2 | **DLT registration** (entity, sender ID, en + te OTP and order templates) | M0 live login | 3 days – 2 weeks |
| 3 | MSG91 (or Fast2SMS) account, linked to DLT | M0 live login | 1–2 days |
| 4 | Meta Business verification + WhatsApp Business number | M0 (WhatsApp OTP) / M5 | 1–3 weeks |
| 5 | Google Cloud billing account (Maps), budget alerts | M2 | 1 day |
| 6 | Firebase project (FCM, Crashlytics) | M3/M5 | 1 day |
| 7 | Google Play developer account | M3 builds / M8 beta | 2–7 days (identity verification) |
| 8 | Razorpay or Cashfree business account (+ Route/Payouts) | M4 / M7 | 1–3 weeks |
| 9 | Exotel (or Knowlarity) account + KYC for virtual numbers | M5–M6 | 1–2 weeks |
| 10 | KYC provider (only if not manual) | M1 scale-up | 1–2 weeks |
| 11 | Oracle Cloud + DigitalOcean (or E2E) accounts | Staging now; production by M4 | 1 day |
| 12 | Sentry, Grafana Cloud, PostHog, UptimeRobot, Brevo | M0–M8 | minutes |
| 13 | Grievance officer named, privacy policy, DPDP consent text (en + te) | M8 beta | — |

---

## 8. Production checklist on the budget setup

- **Backups:** managed DB daily backups + point-in-time restore (Option B); on Oracle, nightly `pg_dump` to object
  storage with 14-day retention, and a monthly **restore test**.
- **Security:** SSH keys only, firewall open on 80/443 only, automatic security updates, Postgres not public, strong
  random `JWT_*` secrets, `NODE_ENV=production`, `APP_ENV=production`, `OTP_PROVIDER=msg91` (the mock is refused).
- **Separate staging and production** (different servers, databases, secrets, Razorpay test vs live keys).
- **Monitoring:** UptimeRobot on `/health/live` and `/health/ready`; Sentry; Grafana alerts on error rate and queue
  backlog.
- **Data residency:** DB, object storage and servers in India; scrub PII from Sentry/PostHog/Grafana.
- **Migrations:** `prisma migrate deploy` in the deploy pipeline; never run the demo seed outside dev.

---

## 9. Code and infra work this plan needs

| # | Work | Milestone | Size |
|---|---|---|---|
| 1 | Production Docker Compose (API, worker, web, Typesense, Redis, Caddy), web Dockerfile, ARM-compatible images | before staging | small |
| 2 | GitHub Actions deploy: build images → push to GHCR (free) → SSH deploy to staging, manual approval to production | before staging | small |
| 3 | Backup/restore scripts + runbook | before staging | small |
| 4 | MSG91 SMS provider (+ WhatsApp OTP provider) | M0 live | small |
| 5 | `manual` KYC provider (ops review with document uploads) | M1 live | small |
| 6 | Google / Ola map tiles in consumer app and console | M3 live | small |
| 7 | ADR-010 recording the hosting decision | now | trivial |
| 8 | Self-hosted GitHub runner on the staging VM (saves Actions minutes) | optional | small |

---

## 10. When to move to AWS

Move (or at least move the database to a managed Multi-AZ service) when any of these is true:
- more than ~3 micro-markets or ~300 orders a day;
- the single app server regularly runs above ~70% CPU or memory;
- you need a formal uptime commitment (merchant or investor contracts);
- AWS Activate credits make it free for 12 months.

The ports already in the code (storage, search, cache, providers) mean the move is mainly Terraform and new
environment values, as planned in the devops skill.
