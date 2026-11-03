# ADR-015: Two environments (test, prod) configured by values files

2026-11-03 · Status: accepted

## Context
Before launch, every part of Santha needs a testing environment and a production environment: the backend and its
database, the website and console, and the three Flutter apps. The architecture skill describes AWS (ECS,
RDS, Terraform) with three environments. The cost plan (`docs/deployment-and-costs.md`) says a pilot should start
on a single VM per environment in India, and move to AWS later.

## Decision
- **Environments.** There are two:
  - `test`: automatic on every push to `main`;
  - `prod`: deployed by hand, choosing a commit already checked on test.

  `dev` remains the laptop (fake mode or Docker Compose). The app flavors map as dev → `dev`, test → `stg`
  (labelled "… Test", ids `*.stg`, installs next to prod) and prod → `prod`.
- **Settings.** Non-secret settings are committed per environment in `config/values/<env>.values.yaml`.
  - The backend loads its section when `SANTHA_ENV` is set.
  - An optional overlay `<cloud>.<env>.values.yaml` is picked by `SANTHA_CLOUD`, e.g. `gcp.prod`.
  - Real environment variables override both.
  - Workflows and `santha.sh` read the `web`, `apps` and `deploy` sections from the same files.
  - The loader rejects unknown keys and secret-looking keys, and a unit test validates the committed files.
- **Secrets.** These stay out of git: the server's `.env` (or a secret manager) for backend secrets, GitHub
  environment secrets for SSH, and repository secrets for app signing keys.
- **Runtime.** One VM per environment runs Docker Compose (`infra/deploy/`):
  - API, worker, web, Redis and Typesense;
  - Caddy for HTTPS;
  - on test only, Postgres and S3-compatible storage containers. Prod uses a managed database and bucket in India.

  Images are built once per commit in GitHub Actions and pushed to GHCR, with one web image per environment
  because `NEXT_PUBLIC_*` and the CSP are fixed at build time. `santha.sh` runs:
  - the deploy: pull, a prod backup, migrations from the `tools` image, start and a health wait;
  - rollback, bootstrap, backup and restore.
- **No GitHub paid features.** Prod is gated by a manual `workflow_dispatch`. Environment "required reviewers"
  needs a paid plan on private repos.
- **Behind the proxy.** `TRUST_PROXY=1` makes the per-IP OTP and login limits see the real client. Without it,
  all users share Caddy's IP, and login is blocked after 30 OTP requests an hour.

## Consequences
- Moving hosts changes only the VM and an overlay values file. Moving to AWS ECS/RDS later reuses the images and
  the values files; Terraform replaces `santha.sh`.
- Changing a value means a commit and a deploy, which leaves a review trail. Nobody edits files on a server.
- Not covered yet:
  - iOS builds (they need macOS);
  - blue/green deploys (a short restart blip on deploy);
  - a staging copy of production data (test uses its own data; the demo seed never runs there).
