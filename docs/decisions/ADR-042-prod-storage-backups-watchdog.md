# ADR-042: Production photos on Amazon S3, scheduled backups and a health watchdog

- Status: accepted
- Date: 2026-11-12

## Context
Production runs on the AWS EC2 server it shares with QA (ADR-024). For the soft launch it needs real photo storage
(catalogue, KYC, door proofs), backups that run without a person remembering them, and something that tells the team
when the site, the API or search breaks. The owner chose an AWS S3 bucket in Mumbai for photos.

## Decision
- **Photos.** `aws.prod.values.yaml` sets `s3Endpoint: https://s3.ap-south-1.amazonaws.com`, bucket `santha-prod-media`.
  The storage client uses virtual-hosted addressing for `amazonaws.com` endpoints (path style stays for Spaces, GCS and the
  QA storage container), and `publicUrl()` builds `https://<bucket>.s3.<region>.amazonaws.com/<key>`. `CDN_BASE_URL`
  still wins if a CDN is added later. The bucket allows public reads of `media/*` only; `private/*` (KYC, door photos)
  is reachable only through short-lived signed links.
- **Backups.** `santha.sh backup` (already run before every prod deploy) now also runs from cron every night
  (`sudo ./santha.sh install-cron`), to a dump bucket when `BACKUP_S3_*` is set. An empty `BACKUP_S3_ENDPOINT` means
  Amazon S3 itself. `restore` was already there; the restore drill is part of `docs/launch/go-live.md`.
- **Watchdog.** `santha.sh watch` runs every 5 minutes: API ready, website, Typesense (restarts it and rebuilds the
  index if it was down) and the age of the newest backup (alert after 30 h). It alerts only when the state changes, on
  Telegram (`ALERT_TELEGRAM_*`) and/or a webhook (`ALERT_WEBHOOK_URL`).

## Consequences
- The EC2 server remains one machine: the nightly backup and a rehearsed restore are the safety net, not redundancy.
- The watchdog runs on the same server it watches, so it cannot report a dead server; an external uptime monitor
  (for example UptimeRobot on `https://api.santhaapp.com/v1/health/ready`) covers that and is listed in go-live.md.
- Bucket policy and keys are owner tasks (docs/deploy/README.md, "Production photos on Amazon S3").
