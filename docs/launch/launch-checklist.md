# Launch checklist

Tick each item with a date and an owner. **Beta** items gate the closed beta. **Launch** items gate the
public launch in Nellore. Items marked *(code)* are already in the repository. The rest are business,
legal or operations tasks.

## Product and engineering
- [ ] Beta: all of M0–M8 merged to `main`; `pnpm --filter backend test:fake`, web e2e and Flutter tests green *(code)*
- [ ] Beta: staging deployed from `main` (Terraform apply, migrations run, seed **not** run on staging)
- [ ] Beta: k6 `peak.js` on staging meets all thresholds; record the p95 values here: feed ___ · search ___ · place ___
- [ ] Beta: cold start measured on a Redmi 12C class phone: consumer ___ s · merchant ___ s · rider ___ s (≤ 2.5 s)
- [ ] Beta: landing Lighthouse (mobile) ≥ 90 ×4 on staging: P ___ A ___ BP ___ SEO ___
- [ ] Beta: CodeQL has no open high or critical alerts; ZAP baseline clean, or each finding triaged in `.github/zap-rules.tsv`
- [ ] Launch: external pen test done on staging; criticals and highs closed and retested
- [ ] Beta: Sentry and Crashlytics are receiving events from staging builds; Grafana SLO board and alerts live
- [ ] Beta: PostHog project for staging and prod (India region, or self-hosted in ap-south-1); `POSTHOG_KEY` in Secrets Manager
- [ ] Launch: real provider keys in Secrets Manager (Razorpay live + Route, MSG91 DLT templates approved, WhatsApp templates approved, Exotel numbers, Digio)
- [ ] Beta: backups — RDS PITR on, a restore drill done (time to restore ___)
- [ ] Beta: rollback rehearsed: previous ECS task definition, `prisma migrate` additive-only check *(see runbooks.md)*
- [ ] Beta: PostHog feature flags set up for risky features. COD is already per micro-market in the versioned config (`cod.enabled`).

## Legal, tax and compliance
- [ ] Launch: company GST registration as an e-commerce operator; TCS (s.52) filing process with the CA; TDS 194-O process
- [ ] Launch: FSSAI licence as an e-commerce food business operator; every home kitchen has a registration number on file (M1 KYC)
- [ ] Beta: Privacy, Terms, Grievance and FSSAI pages live in English and Telugu (`/legal/privacy|terms|grievance|fssai`) *(code)*
- [ ] Launch: a separate refund and return policy page (today it is part of Terms); legal to review
- [ ] Beta: grievance officer named, published at `/legal/grievance` and in the app *(code)*; the mailbox grievance@santha.in is monitored
- [ ] Beta: DPDP register complete (`dpdp-register.md`); consent records flowing *(code)*; erasure tested end to end *(code)*
- [ ] Launch: seller details, country of origin and return policy shown as the Consumer Protection (E-Commerce) Rules require
- [ ] Launch: rider insurance policy active; rider agreement signed by each rider
- [ ] Launch: merchant agreement (commission, settlement T+1, refund liability, dispute window) signed by each merchant

## Stores and listings
- [ ] Beta: Play Console internal testing track for consumer, merchant and rider; App Store TestFlight for consumer
- [ ] Launch: listings in English and Telugu (`store-listings.md`), screenshots from `design/mockups`, feature graphic
- [ ] Launch: Play data-safety form; background-location declaration and video for the rider app; foreground service type (location)
- [ ] Launch: content rating questionnaire; target audience 18+

## Operations
- [ ] Beta: on-call rota filled for the two beta weeks (`on-call.md`)
- [ ] Beta: support hours and macros ready (Telugu and English): late order, missing item, refund status, rider not arriving, delete account
- [ ] Beta: city ops onboarded 30 merchants (`beta-plan.md`), photos and catalogue QA done, payouts bank-verified
- [ ] Beta: 10 riders onboarded with KYC, bags and the app; COD deposit process agreed
- [ ] Beta: daily beta review at 18:00 IST — on-time, fill rate, crashes, P1 list
