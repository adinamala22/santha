# ADR-044: Deploys queue per part, the server serialises them

- Status: accepted
- Date: 2026-11-12

## Context
All deploys to one environment shared one GitHub concurrency group (`cancel-in-progress: false`). A group runs one job
and keeps **one** waiting job; a newer waiting job cancels the older one. After merging several pull requests in a row,
the website deploys cancelled the waiting backend deploys (runs for #43 to #47), so QA kept an old backend while
showing the new website.

## Decision
- The group is per environment **and part** (`santha-deploy-<env>-<component>`), so a backend deploy is only ever
  replaced by a newer backend deploy, which is what we want.
- Backend and web still must not run `docker compose` on the same stack at once: `santha.sh deploy|rollback` takes an
  exclusive `flock` on `.deploy.lock` (waits up to 30 minutes), so they take turns on the server.

## Consequences
- Rapid merges deploy the latest backend and the latest web, in either order, never a stale mix.
