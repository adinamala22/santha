# Deploying Santha: test and prod

There are two environments. Every piece of Santha exists in both:

| | **test** (for testing) | **prod** (real users) |
|---|---|---|
| Settings | `config/values/test.values.yaml` | `config/values/prod.values.yaml` (+ optional `<cloud>.prod.values.yaml`) |
| Backend API + worker | `https://api.test.santha.app` | `https://api.santha.app` |
| Website + ops console | `https://test.santha.app` (not indexed by search engines) | `https://santha.app` |
| Database | Postgres container on the test server | Managed Postgres 16 + PostGIS in India |
| Photos and files | Storage container at `media.test.santha.app` | Managed bucket in India |
| Payments, login SMS | Razorpay **test** mode; fixed OTP `123456` | Razorpay live; MSG91 SMS |
| Apps | "Santha Test", "Santha Partner Test", "Santha Rider Test" (flavor `stg`, installs next to prod) | "Santha", "Santha Partner", "Santha Rider" (flavor `prod`) |
| How it ships | Automatically on every push to `main` | By hand: run **deploy** with a commit already checked on test |

The domain in the values files is `santha.app`. If you use another one, change it in both values files and in
the apps' fallback addresses in `packages/santha_core/lib/src/config/app_config.dart`.

## 1. Servers (once per environment)
Each environment is one Linux VM in India with Docker. Any provider works:
- Oracle Cloud Always Free (Hyderabad/Mumbai), which suits **test**;
- DigitalOcean Bangalore;
- E2E Networks;
- AWS EC2 Mumbai;
- GCP Compute Engine Mumbai (asia-south1).

Costs are compared in `docs/deployment-and-costs.md`.

1. Create the VM: Ubuntu 24.04, at least 2 vCPU / 4 GB; ARM is fine. Open ports 22, 80 and 443 only.
2. Install Docker and create the deploy user:
   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo adduser --disabled-password deploy && sudo usermod -aG docker deploy
   sudo mkdir -p /opt/santha && sudo chown deploy: /opt/santha
   ```
3. **prod only:** create a managed **Postgres 16** in an Indian region, then run `CREATE EXTENSION postgis;`.
   Allow only the prod VM to connect, and turn on daily backups with point-in-time restore. Also create a
   **bucket** in India for photos and a second one for database dumps.
4. **DNS:** point these names at the VMs' public IPs.
   - test: `api.test`, `test` and `media.test`.
   - prod: `api` and the bare domain.
   - With Cloudflare, use "DNS only" (grey cloud), so Caddy gets the certificates and sees real client IPs.
5. **Secrets:** on each VM, copy `infra/deploy/server.env.example` to `/opt/santha/.env` and fill it in
   (`config/values/secrets.md` explains each value). Set `SANTHA_ENV=test` or `SANTHA_ENV=prod`, then run
   `chmod 600 /opt/santha/.env`.

## 2. GitHub (once)
1. **Settings → Environments:** create `test` and `prod`. In each, add these secrets:
   - `SSH_HOST`
   - `SSH_USER` (`deploy`)
   - `SSH_PRIVATE_KEY`: a new key pair; put the public key in `~deploy/.ssh/authorized_keys` on that VM.
   - `SSH_KNOWN_HOSTS`: the output of `ssh-keyscan <host>`.
2. **Settings → Variables:** set `DEPLOY_ENABLED=true`. Until then the deploy workflow skips itself.
3. Images go to GitHub Packages (`ghcr.io/<owner>/santha-*`). Each deploy logs the server in with the job's own
   token, so no extra credentials are needed.

## 3. First deploy
1. Push to `main`, or merge a PR. The **deploy** workflow builds the images and deploys **test**.
   - To redeploy by hand: Actions → deploy → Run workflow → `test` and the full commit SHA.
2. On the test VM, once: `cd /opt/santha && ./santha.sh bootstrap`. It creates the city and the first ops admin,
   and asks for the email, mobile and password.
3. Sign in at `https://test.santha.app/admin`.
4. Create the micro-markets (Console → Micro-markets).
5. Import products: `./santha.sh import products.csv`.
6. When test looks good, deploy **prod**: Actions → deploy → Run workflow → `prod`, with the same commit SHA.
   Then run `./santha.sh bootstrap` once on the prod VM.

Every deploy:
- pulls the images for that commit;
- takes a database backup first (prod only);
- runs migrations;
- restarts the services;
- waits until `https://api…/v1/health/ready` and the website answer.

## 4. Day-to-day on a server (`/opt/santha/santha.sh`)
| Command | What it does |
|---|---|
| `./santha.sh status` / `logs api` | Containers and logs |
| `./santha.sh rollback` | Go back to the previous commit (migrations are backward compatible) |
| `./santha.sh backup` | `pg_dump` to the backup bucket; prunes dumps older than `BACKUP_KEEP_DAYS`. Schedule it: `crontab -e` → `30 21 * * * /opt/santha/santha.sh backup` (03:00 IST) |
| `./santha.sh restore prod/santha-prod-….sql.gz` | Restore a dump (asks you to type the environment name) |
| `./santha.sh reindex` | Rebuild search |
| `./santha.sh migrate` | Run migrations only |

## 5. Apps (test and prod builds)
1. **Signing keys.** Create one upload key per app and keep each `.jks` file and its passwords safe (not in git):
   `keytool -genkeypair -keystore consumer-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`.
   Add these repository secrets for each app:
   - `CONSUMER_KEYSTORE_B64` (`base64 -w0 consumer-upload.jks`)
   - `CONSUMER_KEYSTORE_PASSWORD`
   - `CONSUMER_KEY_ALIAS`
   - `CONSUMER_KEY_PASSWORD`

   Then the same four with the `MERCHANT_` and `RIDER_` prefixes.
2. **Build.** Run Actions → **apps-release** → Run workflow → `test` or `prod` → all apps or one.
   - The API address and flavor come from the values file.
   - The signed APK and AAB files are attached to the run.
3. **Test builds** install alongside the real apps, as "Santha Test" and so on.
   - Hand the APKs to testers.
   - Or set up Firebase App Distribution: add the variables `FIREBASE_APP_ID_CONSUMER_STG`,
     `FIREBASE_APP_ID_MERCHANT_STG` and `FIREBASE_APP_ID_RIDER_STG`, plus the secret `FIREBASE_SERVICE_ACCOUNT_JSON`.
     Each run then sends them to the `santha-testers` group.
4. **Prod builds** go to Google Play.
   - Create the three apps in the Play Console: `app.santha.consumer`, `app.santha.merchant` and `app.santha.rider`.
   - Upload the first AAB by hand.
   - After that, set the variable `PLAY_UPLOAD=true` and the secret `PLAY_SERVICE_ACCOUNT_JSON`, and each prod run
     uploads to the **internal** track.
   - Promote to closed testing, then production, in the Play Console, with a staged rollout of 10 % → 50 % → 100 %.
5. iOS needs a Mac or a macOS CI runner plus an Apple developer account. It is not set up yet.

## What is still missing before real users
See `docs/launch/launch-checklist.md`. In particular:
- Firebase config in the apps (push notifications);
- real masked calling (Exotel) and WhatsApp providers;
- the MSG91 DLT templates;
- Razorpay live keys and the webhook URL `https://api.santha.app/v1/webhooks/razorpay`. In Razorpay test mode, use `https://api.test.santha.app/v1/webhooks/razorpay`.
