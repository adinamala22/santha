# Runbooks

Each runbook gives:
- **Detect**: the alert or symptom;
- **Contain**: the first 15 minutes;
- **Fix**: the remedy;
- **After**: the follow-up.

Severities and escalation are in `on-call.md`. Every console action you take writes an audit row, so note
the request id in the incident channel.

## 1. Payments failing (UPI success below 92 %, or webhooks not arriving)
- **Detect.**
  - Grafana `payment_success_rate` alert.
  - Many `payment_failed` events in PostHog.
  - Razorpay status page.
- **Contain.**
  - If Razorpay is down, make sure cash on delivery is on for the affected micro-markets: Console → Micro-markets → COD rules (`cod.enabled`). This publishes a new config version with an audit row.
  - Tell customers through WhatsApp or SMS broadcast. There is no in-app banner yet.
- **Fix.**
  - Check the webhook delivery log in the Razorpay dashboard and the `/v1/payments/webhook` 4xx rate.
  - If the webhook secret was rotated, update it in Secrets Manager and redeploy.
  - Orders stuck in `AWAITING_PAYMENT` expire on their own (M4 timer).
  - Captured payments with no order are listed by reconciliation (Console → Payouts → Reconciliation): refund them there.
- **After.** Run reconciliation for the day; every mismatch must be resolved or explained.

## 2. Merchant alerts not reaching stores (p95 above 5 s, or stores missing orders)
- **Detect.**
  - Notification latency alert.
  - Spike in `order.expired`.
  - Stores auto-paused (`merchant.auto_paused`).
- **Contain.**
  - Check FCM status.
  - SMS and voice fallbacks (M5) still run: confirm they are firing in the notification log.
  - Ask city ops to phone the affected stores.
- **Fix.**
  - FCM credential expired: rotate it in Secrets Manager.
  - MSG91 DLT template rejected: switch to the approved template id.
  - Ask stores that were auto-paused by the incident to switch back to Open in the merchant app (Orders → store toggle). City ops can walk them through it on the phone.
- **After.** Contact customers whose orders expired; check that the refunds went through automatically.

## 3. No riders, or dispatch is slow (p90 above 3 min)
- **Detect.**
  - `customer.finding_courier` notifications.
  - Many `fulfilment.delayed` events.
- **Contain.**
  - The fallback ladder (M6) already offers the store the self-delivery bonus automatically when no rider accepts.
  - Call the standby riders.
- **Fix.**
  - Use Console → Live orders → Reassign or Force self-delivery. Both write audit rows.
  - Check that the rider app is sending location (`rider.location` rate).
- **After.** Compare rider supply with demand by hour; adjust the shift plan.

## 4. API outage or high error rate
- **Detect.**
  - ALB 5xx alert.
  - Sentry spike.
  - Health check failing.
- **Contain.**
  - Check ECS task health.
  - If a deploy happened in the last hour, **roll back** (section 7).
  - If the database is the cause, check RDS CPU, connections and failover events.
- **Fix.**
  - Scale the ECS service.
  - Kill long queries (`pg_stat_activity`).
  - Redis down: sessions and rate limits fail closed. Restore ElastiCache; BullMQ jobs resume on their own.
- **After.** Write a post-incident review within 2 working days for any P1.

## 5. Search down or degraded (Typesense)
- **Detect.** The search p95 alert, or 5xx on `/v1/search`.
- **Contain.** The apps fall back to the cached catalogue (ADR-009). Search is read-only, so orders are unaffected.
- **Fix.** Restart Typesense, then rebuild the index (`pnpm --filter backend search:reindex`). Check the zero-result rate.

## 6. Personal data breach
1. **Within 1 hour.**
   - The incident lead and the grievance officer are told.
   - The facts are preserved: no deleting of logs.
   - Access is contained: rotate keys and the JWT signing secret (this signs everyone out), and block the IPs at the WAF.
  - A per-user session revoke endpoint does not exist yet. Blocking the account has the same effect: `/v1/me` refuses inactive accounts.
2. **Within 24 hours.**
   - Find the scope: which data principals and which fields.
   - Use the audit log (`GET /v1/ops/audit`) and the CloudTrail logs.
3. **Notify.**
   - Tell the Data Protection Board and every affected user without delay, as the DPDP Rules require.
   - CERT-In within 6 hours for reportable incidents.
4. **Message to users.**
   - en: "On {date} we found that {what} about your Santha account may have been accessed without permission. We have {what we did}. You can {what to do}. Questions: grievance@santha.in."
   - te: "{date}న మీ సంత ఖాతాకు సంబంధించిన {what} అనుమతి లేకుండా చూడబడి ఉండవచ్చని గుర్తించాం. మేము {what we did}. మీరు {what to do}. ప్రశ్నలకు: grievance@santha.in."
5. **After.** Write a review; update `dpdp-register.md` if any processing changes.

## 7. Rollback
- **ECS.** Redeploy the previous task definition revision:
  `aws ecs update-service --cluster santha-<env> --service api --task-definition api:<prev>`.
  The web app rolls back the same way.
- **Migrations.**
  - Migrations are additive within a release: new columns are nullable or defaulted, and nothing is dropped
    until the next release. That is why a code rollback needs no schema rollback.
  - If a migration must be undone, restore to a point in time into a new instance and switch over. Do not hand-edit production.
- **Apps.**
  - Halt the staged rollout in the Play Console.
  - Feature flags turn off new behaviour without a release.

## 8. Money mismatch (reconciliation)
- **Detect.** Console → Payouts → Reconciliation shows open items after the nightly run.
- **Fix.**
  - Every item is one of three kinds:
    - a captured payment with no order: refund it;
    - an order with no captured payment: check the provider;
    - an amount mismatch: escalate to finance.
  - Resolve each item in the console with a note (audit row `recon.resolved`).
  - Payouts for affected merchants stay `on_hold` until the item is resolved.
