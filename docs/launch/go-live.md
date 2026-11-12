# Go-live: flip production from pre-launch to live

Production today runs in pre-launch mode (ADR-024): the website and the ops console only, mock providers, apps answer
"launching soon". This is the ordered list to make it live for the soft launch. Owner steps are marked **[owner]**.

## 0. Accounts and keys (start now; some take days)
| What | Who | Notes |
|---|---|---|
| Razorpay live account, KYC done, live keys, webhook | owner | Webhook URL `https://api.santhaapp.com/v1/webhooks/razorpay`; events `payment.captured`, `payment.failed`, `refund.processed`; copy the webhook secret |
| Meta WhatsApp Business: verified business, sender number, template `santha_login_otp` (English and Telugu), system user token | owner | docs/integrations/whatsapp-otp.md |
| Firebase project (Android apps for the three prod app ids), service account JSON | owner | `FCM_SERVICE_ACCOUNT_B64` and `apps.firebase` in `prod.values.yaml` |
| Google Cloud project with billing: Maps SDK for Android, Places, Geocoding, Directions; server key (restricted to the server IP) and Android keys | owner | `GOOGLE_MAPS_SERVER_KEY` |
| AWS: S3 bucket `santha-prod-media` and a private dump bucket `santha-prod-backups` in ap-south-1, one IAM user for each | owner | docs/deploy/README.md, "Production photos on Amazon S3" |
| Telegram bot for alerts | owner | `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` |
| Google Play Console developer account | owner | docs/launch/ |

Keys go into `/opt/santha-prod/.env` on the server only (`chmod 600`), never into the repository or a chat.

## 1. Prepare the server `.env` (prod)
`SANTHA_ENV=prod`, `SANTHA_CLOUD=aws`, then the names in `config/values/secrets.md`: strong `JWT_ACCESS_SECRET` and
`JWT_REFRESH_SECRET` (32+ characters, different from QA), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET` (live), `WHATSAPP_ACCESS_TOKEN`, `FCM_SERVICE_ACCOUNT_B64`, `GOOGLE_MAPS_SERVER_KEY`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`,
`OPS_ALERT_PHONES`, `TYPESENSE_API_KEY`, `LOCALDB_PASSWORD`, the alert variables.

## 2. Install the safety net first
1. `./santha.sh backup` once by hand and check the dump appears in the bucket.
2. `sudo ./santha.sh install-cron` (nightly backup and 5-minute health check).
3. **Restore drill** on QA, not prod: restore the newest prod dump into the QA stack with `./santha.sh restore`, time it, and write the time in `docs/launch/launch-checklist.md`.
4. **[owner]** an external uptime monitor on `https://api.santhaapp.com/v1/health/ready` and `https://santhaapp.com/` (UptimeRobot free plan, alert to your phone).

## 3. Flip the values (one small PR)
In `config/values/aws.prod.values.yaml` replace the pre-launch block with the live one (`docs/launch/aws.prod.live.values.yaml.txt` has it ready):

```yaml
backend:
  launchStage: live
  otpProvider: none
  kycProvider: manual
  paymentsProvider: razorpay
  pushProvider: fcm          # once Firebase is set up; otherwise mock and apps run without push
  mapsProvider: google
  whatsappProvider: cloud
  whatsappPhoneNumberId: "<Phone number ID>"
  # opsLoginOtp: remove the line (the ops console needs its second factor once live)
```

Merge it, then run the **deploy** pipeline for PROD (promote the build QA is running). The backend refuses to start if
any production check fails, so read the container log if it does not come up: `./santha.sh logs api`.

## 4. First data
1. `./santha.sh bootstrap` if no admin exists (admin email, mobile, name, 14+ character password).
2. Ops console: create the city and the micro-markets for Nellore (copy the polygons from QA), coverage and fees.
3. Do **not** run the seed on prod.

## 5. Smoke tests on prod (with real accounts; tell the team first)
1. Ops console sign-in with the WhatsApp code.
2. A new phone signs in on the consumer app: the code arrives on WhatsApp.
3. A merchant is onboarded end to end (manual KYC, photos arriving in S3 under `media/`), reviewed and approved by ops.
4. A COD order is placed, accepted, delivered with the OTP; check the rider payout line.
5. An online order of **Rs 1** with a real card or UPI, then refund it from the console; confirm both in Razorpay.
6. A push notification arrives on the consumer and merchant phones.
7. Rider SOS pages the on-call phones (Telegram alert).
8. Stop the API container for a minute: the Telegram alert arrives, then the recovery message.

## 6. Rollback
- Backend or web: `./santha.sh rollback backend` or `rollback web` (previous tag; migrations are additive).
- Back to pre-launch: revert the values PR and redeploy; the apps show "launching soon" again.
- Database: `./santha.sh restore prod/santha-prod-<stamp>.sql.gz` (about the drill time; the API is down meanwhile).

## 7. After going live
Daily at 18:00 IST review (on-time rate, failed payments, SOS, support). Move the repository back to private. Add MSG91
SMS fallback and Digio KYC before growing beyond the first 30 merchants.
