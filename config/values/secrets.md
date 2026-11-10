# Secrets (never in a values file)

The backend refuses any of these in `*.values.yaml`. Set them in the server's `/opt/santha/.env`, or in a secret
manager that injects environment variables. Use different values in test and prod.

| Variable | test | prod | How to make it |
|---|---|---|---|
| `SANTHA_ENV` | `test` | `prod` | selects the values file |
| `SANTHA_CLOUD` | (empty) | e.g. `gcp` | optional overlay `<cloud>.<env>.values.yaml` |
| `REGISTRY` | `ghcr.io/<github owner>` | same | where the images are |
| `ACME_EMAIL` | your email | your email | Let's Encrypt notices |
| `DATABASE_URL` | `postgresql://santha:<LOCALDB_PASSWORD>@postgres:5432/santha` | managed DB URL with `?sslmode=require` | from your DB provider |
| `LOCALDB_PASSWORD` | random | (unused) | `openssl rand -hex 24` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | random | random, at least 32 characters | `openssl rand -base64 48` (each different) |
| `TYPESENSE_API_KEY` | random | random | `openssl rand -hex 24` |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | random (storage container) | bucket keys (Spaces key / GCS HMAC / IAM) | provider console |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | **test** keys `rzp_test_…` | **live** keys | Razorpay dashboard |
| `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | optional | required | MSG91 + DLT template |
| `WHATSAPP_ACCESS_TOKEN` | only with `whatsappProvider: cloud` | only with `whatsappProvider: cloud` | Meta Business Suite → System users → Generate token (`whatsapp_business_messaging`), never-expiring (docs/integrations/whatsapp-otp.md) |
| `OPS_ALERT_PHONES` | on-call numbers, e.g. `+919876543210,+919876543211` | required before launch | the people on call for rider SOS (ADR-034); private numbers, so only in `.env` |
| `FCM_SERVICE_ACCOUNT_B64` | optional | required | Firebase service account JSON, base64 |
| `GOOGLE_MAPS_SERVER_KEY` | optional | required | Google Cloud console (restrict to the server IP) |
| `POSTHOG_KEY` | optional | optional | PostHog project |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` | bucket for dumps | bucket for dumps | provider console (India region) |
| `BACKUP_KEEP_DAYS` | `7` | `30` | — |
| `CLOUDFLARE_TUNNEL_TOKEN` | only with `deploy.ingress: tunnel` (e.g. `SANTHA_CLOUD=laptop`) | (unused) | Cloudflare Zero Trust → Networks → Tunnels → the token after `--token` |

Template: `infra/deploy/server.env.example`.
