# ADR-024: Separate pipelines per part (QA/PROD), prod on the shared server, pre-launch mode

Status: accepted (2026-11-05)

## Context
The product owner wants to put the website live on the production domain (santhaapp.com) now, before the apps
launch. They also want separate deployment pipelines for the backend, the website and the mobile apps, each
with **QA** (= test) and **PROD** (= production). Until now one `deploy` workflow built and deployed the backend
and the website together, and no prod server existed.

The product owner's choices:
- Prod runs on the existing AWS server, next to test.
- A prod backend is deployed too, so the prod forms save leads to a prod database.
- GitHub environments stay `test` and `prod`, labelled QA and PROD.
- The ops console signs in on password only until an OTP provider is set up.

## Decision
1. **Three pipelines.**

   | Pipeline | Builds | Deploys |
   |---|---|---|
   | `deploy-backend.yml` "Deploy · Backend" | API, worker and tools images | — |
   | `deploy-web.yml` "Deploy · Web" | QA and PROD website images (each environment's API address is baked in) | — |
   | `apps-release.yml` "Release · Mobile apps" | Apps, on demand, QA or PROD | — |

   - The backend and website pipelines build on a push to `main` that touches their files and deploy that build
     to QA automatically.
   - PROD is a manual run. With no tag it promotes exactly the build QA is running for that part (no rebuild).
   - The shared job `deploy-env.yml` runs `santha.sh deploy <tag> backend|web` over SSH. It allows one deploy at
     a time per environment.
   - The old combined `deploy.yml` is removed. Live e2e runs after either pipeline deploys QA.
2. **Per-part tags on the server.** `santha.sh` keeps `.tag-backend` and `.tag-web`. Compose uses `BACKEND_TAG`
   and `WEB_TAG`, so the website can be deployed or rolled back without touching the API, and the other way
   round. `santha.sh tag <part>` prints a part's tag.
3. **Prod and test on one server.**
   - Test stays in `/opt/santha`; prod lives in `/opt/santha-prod` with its own compose project, database
     volume and `.env`.
   - Both sit behind one shared Caddy in `/opt/santha-edge` (`deploy.ingress: edge`, `compose.edge.yml`). Each
     stack joins the `santha-edge` network as `<env>-api`, `<env>-web` and `<env>-storage`, and writes its sites
     to `sites/<env>.caddy`.
   - The overlays `aws.test` and `aws.prod` (`SANTHA_CLOUD=aws`) select this. `www.santhaapp.com` redirects to
     santhaapp.com.
   - When prod moves to its own server, drop the `aws.prod` overlay and it uses its own Caddy again.
4. **Pre-launch mode** (`LAUNCH_STAGE=prelaunch`, `aws.prod`).
   - The API serves only the website (site config, leads, store pages) and the ops console.
   - Everything the apps use answers 503 `PRELAUNCH`: app sign-in, cart, orders, payments, merchants, riders
     and realtime.
   - So production starts without live payment, KYC, SMS, push or maps accounts. With `LAUNCH_STAGE=live` every
     production check applies again.
5. **Password-only ops console before launch** (`OPS_LOGIN_OTP=off`).
   - The password step opens the session directly. The rate limits, the audit trail and the 8-hour console
     session stay.
   - The backend refuses `off` in production once live, and refuses the fixed mock OTP as a production second
     factor.
6. **Backups.** With no backup bucket configured, `santha.sh backup` keeps gzip dumps in `./backups` on the
   server (14 days). Prod backs up before every backend deploy.

## Consequences
- **Shared server:**
  - One server is a single point of failure for both environments, and test and prod share its memory (about
    1.8 GB plus swap).
  - A test deploy cannot take prod's ports. Only the edge Caddy is shared.
- **Before going live:**
  - Set the live provider keys in `/opt/santha-prod/.env`.
  - Set `launchStage: live` and remove `opsLoginOtp: "off"`; the backend refuses to start otherwise.
  - Ideally, move prod to its own server and a managed database.
- **First switch-over:** `SANTHA_CLOUD=aws` must be set in test's `.env` when this lands, and `/opt/santha-edge`
  must exist. Test's own Caddy is replaced by the edge on its first deploy, with a few seconds of HTTPS
  re-issue.
