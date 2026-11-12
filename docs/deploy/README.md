# Deploying Santha: test and prod

There are two environments. Every piece of Santha exists in both:

| | **test** (for testing) | **prod** (real users) |
|---|---|---|
| Settings | `config/values/test.values.yaml` | `config/values/prod.values.yaml` (+ optional `<cloud>.prod.values.yaml`) |
| Backend API + worker | `https://api.test.santhaapp.com` | `https://api.santhaapp.com` |
| Website + ops console | `https://test.santhaapp.com` (not indexed by search engines) | `https://santhaapp.com` |
| Database | Postgres container on the test server | Managed Postgres 16 + PostGIS in India |
| Photos and files | Storage container at `media.test.santhaapp.com` | Managed bucket in India |
| Payments, login SMS | Razorpay **test** mode; fixed OTP `123456` | Razorpay live; MSG91 SMS |
| Apps | "Santha Test", "Santha Partner Test", "Santha Rider Test" (flavor `stg`, installs next to prod) | "Santha", "Santha Partner", "Santha Rider" (flavor `prod`) |
| How it ships | Automatically on every push to `main` | By hand: run **deploy** with a commit already checked on test |

The domain is `santhaapp.com`, registered at GoDaddy. To change it, edit both values files and the apps' fallback
addresses in `packages/santha_core/lib/src/config/app_config.dart`.

**Test today:** an AWS EC2 `t4g.small` in Hyderabad (ap-south-2) at Elastic IP `98.130.34.49`. GoDaddy DNS has
A records for `test`, `api.test` and `media.test` pointing to it.

## 1. Servers (once per environment)
Each environment is one Linux VM in India with Docker. Any provider works:
- Oracle Cloud Always Free (Hyderabad/Mumbai), which suits **test**;
- DigitalOcean Bangalore;
- E2E Networks;
- AWS EC2 Mumbai;
- GCP Compute Engine Mumbai (asia-south1).

Costs are compared in `docs/deployment-and-costs.md`.

1. Create the VM: Ubuntu 24.04, at least 2 vCPU / 4 GB. ARM or x86 both work: the images are built for both.
   Open ports 22, 80 and 443 only.
2. Prepare it with `sudo bash infra/deploy/setup-server.sh` (copy the file over first). It:
   - installs Docker;
   - creates the `deploy` user and `/opt/santha`;
   - opens 80/443 in the host firewall;
   - adds swap on small machines;
   - turns on security updates.
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

### Free test server: Oracle Cloud Always Free, step by step
Always Free resources don't expire. They include up to 4 ARM cores and 24 GB RAM, 200 GB of disk and 10 TB of
traffic a month. A card is needed at sign-up for identity checks only; stay on Always Free resources and nothing
is charged.

1. **Sign up** at cloud.oracle.com. Choose **India South (Hyderabad)** or **India West (Mumbai)** as the home
   region. Only home-region resources are free, and the home region can't be changed later.
2. **Create the VM:** Compute → Instances → Create instance.
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** Ampere → `VM.Standard.A1.Flex`, 2 OCPU and 12 GB, or up to 4 OCPU and 24 GB.
     - If you see "Out of capacity", try another availability domain, a smaller size, or again later.
   - **Networking:** create a new VCN with a public subnet, and assign a public IPv4 address.
   - **SSH keys:** upload your public key, or download the generated one and keep it safe.
   - **Boot volume:** 100 GB is plenty, and up to 200 GB total is free.
3. **Open the web ports in Oracle's network.**
   - Go to Networking → Virtual cloud networks → your VCN → Security Lists → Default.
   - Add ingress rules from `0.0.0.0/0` for TCP 80 and TCP 443 (and UDP 443 for HTTP/3).
4. **Make the IP permanent.** On the instance, go to Attached VNICs → IPv4 addresses and change the public IP to
   **reserved**. A reserved IP is free while it's attached.
5. **Log in and prepare the server:**
   ```sh
   scp infra/deploy/setup-server.sh ubuntu@<ip>:
   ssh ubuntu@<ip> 'sudo bash setup-server.sh'
   ```
   The script also opens 80/443 in Ubuntu's own firewall. Oracle's images block them by default, which is the
   most common reason a fresh Oracle server "doesn't respond".
6. **DNS (Hostinger → Domains → DNS / Nameservers → DNS records):** add **A** records for `test`, `api.test` and
   `media.test`, each pointing to the server's IP, with TTL 300.
7. Carry on with **Secrets** below (`SANTHA_ENV=test`, plus a long random `LOCALDB_PASSWORD`), then section 2.

Oracle may reclaim Always Free instances that sit almost idle for 7 days. A deployed test stack normally isn't
idle, but if the instance is stopped, start it again from the console. The data on its disk is kept.

### Test on your own computer (Cloudflare Tunnel, ₹0)
Use this while there is no cloud server yet. The test stack runs in Docker on your PC (WSL 2 on Windows), and a
free **Cloudflare Tunnel** brings `test`, `api.test` and `media.test` to it over HTTPS. There are no open ports
and no router changes, and it works behind any home or office network. The apps and the website use the same
addresses as on a cloud VM, so nothing needs rebuilding when test moves to one.

Limits: test is only up while the PC is on, awake and signed in. Turn off sleep while plugged in (Settings →
System → Power). It suits a few testers, not a pilot with real shops.

1. **Domain on Cloudflare (once).** Sign up at dash.cloudflare.com (Free plan) → **Add a domain** → enter
   your domain. Cloudflare shows two nameservers. At your registrar (Hostinger → Domains → Nameservers →
   change to custom), replace the nameservers with Cloudflare's. Wait until Cloudflare says the domain is
   **Active** (minutes to a few hours). If the test A records point at a cloud server,
   delete them first; the tunnel creates its own records.
2. **Create the tunnel.** Cloudflare dashboard → **Zero Trust** → Networks → **Tunnels** → Create a tunnel →
   **Cloudflared** → name it `santha-test`. On the "install connector" page, copy the long token after
   `--token` (don't run the install command it shows; Docker runs cloudflared for you).
3. **Public hostnames.** In the tunnel → **Public Hostname** → add three, each with service type **HTTP** and
   URL **`caddy:80`**:
   - `api.test.<your domain>`
   - `test.<your domain>`
   - `media.test.<your domain>`

   Cloudflare creates the DNS records itself.
4. **Deploy** from the repo folder in PowerShell:
   ```powershell
   .\infra\deploy\laptop\test-env.ps1 deploy
   ```
   - The first run creates `/opt/santha/.env` in WSL with random secrets and stops. Open it with
     `wsl -d Ubuntu-24.04 -u root nano /opt/santha/.env`, paste the token into `CLOUDFLARE_TUNNEL_TOKEN`, save,
     and run `deploy` again.
   - It builds the images from your checkout (several minutes the first time), runs migrations, starts the
     stack and waits until `https://api.test.<domain>/v1/health/ready` answers.
   - Run `deploy` again whenever you want test to have your latest code. On Linux, run
     `sudo infra/deploy/laptop/laptop.sh deploy` instead.
5. **Once:** `.\infra\deploy\laptop\test-env.ps1 bootstrap` (first admin and city), then section 3 from step 3.
6. **Keep it up:** `.\infra\deploy\laptop\test-env.ps1 autostart` starts it at every Windows sign-in. Without
   it, WSL stops when idle and the test site goes down. Other commands: `status`, `logs api`, `rollback`, `stop`.

Payments use the in-app mock until you add Razorpay **test** keys to `.env` and delete its
`PAYMENTS_PROVIDER=mock` line. Settings: `config/values/laptop.test.values.yaml`. When test moves to a cloud VM,
point the three hostnames at the VM in DNS instead of the tunnel, and delete the tunnel.

## 2. GitHub (once)
1. **Settings → Environments:** create `test` and `prod`. In each, add these secrets:
   - `SSH_HOST`
   - `SSH_USER` (`deploy`)
   - `SSH_PRIVATE_KEY`: a new key pair; put the public key in `~deploy/.ssh/authorized_keys` on that VM.
   - `SSH_KNOWN_HOSTS`: the output of `ssh-keyscan <host>`.
   - Variable `DEPLOY_DIR`: the stack's folder on the server. Default `/opt/santha`; prod on the shared AWS server
     uses `/opt/santha-prod` (ADR-024).
2. **Settings → Variables:** set `DEPLOY_ENABLED=true`. Until then the deploy pipelines skip themselves.
3. Images go to GitHub Packages (`ghcr.io/<owner>/santha-*`). Each deploy logs the server in with the job's own
   token, so no extra credentials are needed.

## 3. Pipelines: QA and PROD (ADR-024)
| Pipeline (Actions) | QA (test) | PROD (production) |
|---|---|---|
| **Deploy · Backend** | automatic on a push to `main` that touches the backend | Run workflow → PROD |
| **Deploy · Web** | automatic on a push to `main` that touches the website | Run workflow → PROD |
| **Release · Mobile apps** | Run workflow → QA (test APKs, "Santha Test") | Run workflow → PROD (Play bundles) |

- For a PROD run, leave **tag** empty to promote exactly what QA runs now for that part. Or paste a full commit
  SHA built by a push to `main`.
- Deploy the backend to an environment before its website.
- Backend and web deploy separately: each has its own tag on the server and its own rollback.
- Each part is **built once** for every environment (ADR-025). PROD runs the very image QA tested. The website's
  addresses come from the values file's `web` section when it starts.

## 3a. First deploy
1. Push to `main`, or merge a PR. **Deploy · Backend** and **Deploy · Web** build the images and deploy **QA**.
   - To redeploy by hand: Actions → the pipeline → Run workflow → QA and the full commit SHA.
2. On the test VM, once: `cd /opt/santha && ./santha.sh bootstrap`. It creates the city and the first ops admin,
   and asks for the email, mobile and password.
3. Sign in at `https://test.santhaapp.com/admin`.
4. Create the micro-markets (Console → Micro-markets).
5. Import products: `./santha.sh import products.csv`.
6. When QA looks good, deploy **PROD**: **Deploy · Backend** → Run workflow → PROD, then **Deploy · Web** → PROD.
   Leave the tag empty to promote QA's build. Then run `./santha.sh bootstrap` once in the prod folder.

### Prod on the shared AWS server, before launch (ADR-024)
Today prod runs on the same AWS server as test.

| Part | Where |
|---|---|
| Test | `/opt/santha` (`SANTHA_CLOUD=aws`) |
| Prod | `/opt/santha-prod` (`SANTHA_ENV=prod`, `SANTHA_CLOUD=aws`, `LOCALDB_PORT=5434`) |
| Shared HTTPS front door for both | `/opt/santha-edge` |

The `aws.prod` overlay runs prod in **pre-launch mode**. Only the website and the ops console are served, and the
console signs in on password only. No live payment, KYC or SMS keys are needed yet.

**DNS (GoDaddy → santhaapp.com → DNS):**

| Type | Name | Value |
|---|---|---|
| A | `@` | the server's IP |
| A | `api` | the server's IP |
| CNAME | `www` | `santhaapp.com` |

Remove GoDaddy's parking or forwarding on `@`.

**Going live:**
1. Put the live keys (MSG91 or WhatsApp, Razorpay, Digio, FCM, Maps) in `/opt/santha-prod/.env`.
2. In `aws.prod.values.yaml`, set `launchStage: live` and remove `opsLoginOtp` and the mock providers.
3. Deploy the backend to PROD.

The backend refuses to start live with mock providers or a password-only console.

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
| `./santha.sh rollback [backend|web]` | Go back to that part's previous commit (migrations are backward compatible) |
| `./santha.sh tag backend` / `tag web` | The commit deployed for that part |
| `./santha.sh backup` | `pg_dump` to the backup bucket (or `./backups` on the server when no bucket is set); prunes dumps older than `BACKUP_KEEP_DAYS`. Schedule it: `crontab -e` → `30 21 * * * /opt/santha/santha.sh backup` (03:00 IST) |
| `./santha.sh restore prod/santha-prod-….sql.gz` | Restore a dump (asks you to type the environment name) |
| `./santha.sh reindex` | Rebuild search |
| `./santha.sh migrate` | Run migrations only |

### Querying the test database
The test Postgres listens on the server's `127.0.0.1:5432` only (`LOCALDB_PORT`), never on the internet.
- **Terminal:** `ssh -t -i <key.pem> ubuntu@<server> "sudo docker exec -it santha-test-postgres-1 psql -U santha -d santha"`
- **DBeaver** (or Beekeeper Studio, pgAdmin): New connection → PostgreSQL.
  - Main tab: host `localhost`, port `5432`, database `santha`, user `santha`, password = `LOCALDB_PASSWORD` from
    the server's `.env`.
  - SSH tab: use an SSH tunnel to the server (`ubuntu`, public key auth with the `.pem`).

Read only. Change data through the apps or the console: order states, money and audit events must go through the
backend. Prod uses a managed database; give tools a read-only user there.

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
5. **Push notifications (ADR-027).** These steps are done once, in the Firebase console.
   - Create one Firebase project, for example `santha`.
   - Add **Android apps** with these package names:
     - QA (stg builds): `app.santha.consumer.stg`, `app.santha.merchant.stg`, `app.santha.rider.stg`;
     - PROD: `app.santha.consumer`, `app.santha.merchant`, `app.santha.rider`.
   - You don't need to download `google-services.json`: the apps get their settings at build time.
   - In `config/values/test.values.yaml` (stg ids) and `prod.values.yaml` (prod ids), fill `apps.firebase`:
     - `projectId` and `senderId`: from Project settings → General / Cloud Messaging;
     - `apiKey`: the Web API key;
     - `appIds`: each app's "App ID" (`1:…:android:…`).
   - Project settings → Service accounts → **Generate new private key**. On the server, add these to the stack's `.env`:
     - `FCM_SERVICE_ACCOUNT_B64=$(base64 -w0 key.json)`;
     - `PUSH_PROVIDER=fcm`, or set `backend.pushProvider: fcm` in the values file.
   - Then redeploy the backend and rebuild the apps.
6. iOS needs a Mac or a macOS CI runner plus an Apple developer account. It is not set up yet. Push on iOS also needs an APNs key in Firebase.

## 6. Production photos on Amazon S3, backups and alerts (ADR-042)
Owner steps, once, in the AWS console (region **Asia Pacific (Mumbai) ap-south-1**):

1. **Photos bucket** `santha-prod-media`.
   - Block Public Access: leave **on** for everything except "Block public access to buckets and objects granted through new public bucket or access point policies" (turn that one **off**).
   - Bucket policy: public read of `media/*` only. `private/*` (KYC and door photos) stays closed and is served by short-lived signed links.
     ```json
     {"Version":"2012-10-17","Statement":[{"Sid":"PublicReadMedia","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::santha-prod-media/media/*"}]}
     ```
   - CORS (so the apps and the website can upload with a signed link):
     ```json
     [{"AllowedMethods":["PUT","GET"],"AllowedOrigins":["*"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]
     ```
2. **IAM user** `santha-prod-media` with this policy only, then create an access key (these are `S3_ACCESS_KEY` and `S3_SECRET_KEY` in the prod `.env`):
   ```json
   {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":"arn:aws:s3:::santha-prod-media/*"},{"Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::santha-prod-media"}]}
   ```
3. **Backups bucket** `santha-prod-backups`: Block Public Access fully **on**, versioning on, and a lifecycle rule that expires objects after 35 days. A second IAM user `santha-prod-backups` with put, get, list and delete on that bucket only. Its keys are `BACKUP_S3_ACCESS_KEY` and `BACKUP_S3_SECRET_KEY`; set `BACKUP_S3_BUCKET=santha-prod-backups` and leave `BACKUP_S3_ENDPOINT` empty.
4. The values already point there (`aws.prod.values.yaml`: `s3Endpoint`, `s3Bucket`, web `mediaOrigin`). If you choose other bucket names, change them in that file.
5. On the server, as the deploy user, in `/opt/santha-prod`: `./santha.sh backup` once, then `sudo ./santha.sh install-cron` (nightly backup at 02:30 IST and a health check every five minutes).
6. Alerts: add `ALERT_TELEGRAM_BOT_TOKEN` and `ALERT_TELEGRAM_CHAT_ID` (or `ALERT_WEBHOOK_URL`) to `.env`, then `./santha.sh watch` prints `ok`. Add an outside monitor (UptimeRobot) for `https://api.santhaapp.com/v1/health/ready`, because the watchdog runs on the server it watches.

## What is still missing before real users
See `docs/launch/launch-checklist.md`. In particular:
- Firebase config in the apps for push notifications (§5 step 5);
- real masked calling (Exotel) and WhatsApp providers;
- the MSG91 DLT templates;
- Razorpay live keys and the webhook URL `https://api.santhaapp.com/v1/webhooks/razorpay`. In Razorpay test mode, use `https://api.test.santhaapp.com/v1/webhooks/razorpay`.
