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
   **Active** (minutes to a few hours). Then put your domain in place of `santha.app` in
   `config/values/test.values.yaml` (and `prod.values.yaml` and `packages/santha_core/lib/src/config/app_config.dart`).
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
