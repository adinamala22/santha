---
name: santha-devops
description: Local development, environments, CI/CD, infrastructure as code, secrets, observability, backups and release process for Santha — docker-compose stack, GitHub Actions pipelines for backend/web/Flutter, Terraform for AWS ap-south-1 (ECS Fargate, RDS Multi-AZ + PostGIS, ElastiCache, S3/CloudFront, WAF), OpenTelemetry/Grafana/Sentry, runbooks. Use for any task in infra/, .github/, docker files, deployment, env config, or when something is failing in CI or an environment.
---

# Santha DevOps

## Local
`docker compose up -d` → Postgres 16 + PostGIS (5432), Redis (6379), Typesense (8108), RustFS S3 (9000/9001, ADR-003), Mailpit (8025). `pnpm i && pnpm --filter backend prisma migrate dev && pnpm --filter backend seed && pnpm dev`. Flutter: `melos bootstrap && melos run dev:consumer`. Web: `pnpm --filter web dev`.
No Docker: `pnpm dev:fake` runs the backend with `DATA_STORE=memory` (in-memory stores + demo seed, mock providers, OTP `123456`) plus web; refused outside `APP_ENV=dev` (ADR-005).
`.env.example` documents every variable; copy to `.env` (git-ignored). Providers default to `mock` locally.

## Environments (current: ADR-015)
Two environments, `test` and `prod`. Each is one VM in India running `infra/deploy/compose.yml` through `infra/deploy/santha.sh`.
- Non-secret settings: `config/values/<env>.values.yaml` (+ `<cloud>.<env>` overlay), loaded by the backend via `SANTHA_ENV`/`SANTHA_CLOUD`; never put secrets there.
- Secrets: the server `.env` (`infra/deploy/server.env.example`).
- Deploy: `.github/workflows/deploy.yml` (test on push to main, prod by hand).
- Apps: `apps-release.yml`.
- Guide: `docs/deploy/README.md`.

The AWS layout below is the scale-up target.

### AWS target
dev (shared cloud, small) · staging (prod replica, sandboxes, internal app tracks) · production (Multi-AZ, blue/green). All in AWS ap-south-1. Resource names `santha-{env}-{component}`; tags `env`, `component`, `cost-centre`.

## Pipelines (.github/workflows)
- `backend.yml`: lint → typecheck → unit → fake-mode acceptance (`test:fake`, no Docker) → integration (Testcontainers) → build image → push ECR → deploy staging (ECS blue/green) → smoke → manual approval → prod. Migrations run as a pre-deploy ECS task; only backward-compatible migrations.
- `web.yml`: lint → typecheck → unit → Playwright → build → deploy (Vercel-style on ECS or Amplify; decide at M0 and record ADR).
- `flutter.yml`: `melos run analyze test` → build per flavor → Firebase Test Lab (low-end profile) → fastlane `beta` to Play internal / TestFlight; `release` on tag with staged rollout.
- `infra.yml`: terraform fmt/validate/plan on PR, apply on main with approval.
- Secrets only in GitHub Environments and AWS Secrets Manager; OIDC role assumption, no long-lived keys.

## Terraform (infra/terraform)
Modules: network (VPC, subnets, NAT), ecs (cluster, services backend/web/worker, ALB, WAF), rds (Postgres 16 Multi-AZ, PostGIS, PITR, read replica flag), redis (ElastiCache), storage (S3 + CloudFront, image CDN), typesense (ECS service + EBS or Typesense Cloud variable), observability (OTel collector, Grafana Cloud keys), secrets, iam. One `envs/{dev,staging,prod}.tfvars`.

## Observability & SLOs
OpenTelemetry traces across order placement → payment → dispatch; metrics: payment success, merchant alert latency, acceptance time, dispatch time, ETA breach, API p95, queue lag; logs (pino JSON, PII redacted). Sentry for apps and backend. SLOs: API 99.9%, alert ≤5 s p95, dispatch ≤3 min p90, payment success ≥92% UPI. Alerts → on-call channel.

## Backups & DR
RDS automated daily + PITR (7 d), S3 versioning, quarterly restore drill, RTO 2 h / RPO 15 min. Runbooks in `docs/runbooks/`: payment-webhooks-lag, dispatch-stall, notifications-down, typesense-down, db-failover, rollback.

## Release process
Weekly release train. Backend: blue/green with 10-minute bake. Mobile: staged rollout 10/50/100 with crash-free gate ≥99.5%. Feature flags default off in prod. Changelog in `CHANGELOG.md`.
