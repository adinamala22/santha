# ADR-002: Web app hosting
2026-11-01 · Status: accepted

## Context
The devops skill asks to decide at M0 between "Vercel-style on ECS or Amplify" for `apps/web` (landing, store pages,
ops console). India data residency is mandatory and the ops console handles personal data.

## Decision
Run `apps/web` as a Next.js **standalone** container on **ECS Fargate in ap-south-1**, behind the same ALB/WAF as the
API, with static assets on S3 + CloudFront. The image is built with `NEXT_STANDALONE=1` (see `next.config.ts`).

## Consequences / when to revisit
One deployment model (ECS) for backend, worker and web; same Terraform modules, secrets and observability. No ISR cache
sharing across tasks for now — revisit (shared cache handler on Redis/S3) if store link pages (`/s/[slug]`) need ISR at
scale in M8.
