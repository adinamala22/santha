# Analytics & domain events
Server-side domain events: see `.claude/skills/santha-architecture/references/events.md`.
Client events (PostHog, snake_case, every event carries micro_market_id, app, app_version, locale):
consumer: app_open · location_set · serviceability_result · feed_viewed · search_performed(query, results, zero_result) · merchant_viewed · item_viewed · add_to_cart · cart_merchant_switch · checkout_started · slot_selected · payment_initiated · payment_succeeded · payment_failed · order_placed · order_status_viewed · order_delivered · rating_submitted · issue_reported · refund_issued · reorder_tapped
merchant: onboarding_step_completed · kyc_result · catalogue_item_created(method) · stock_toggled · store_toggled · order_alert_shown · order_accepted(latency) · order_rejected(reason) · fulfilment_choice(mode) · item_unavailable_marked · order_ready · payout_viewed · dispute_raised
rider: online_toggled · offer_shown · offer_accepted · offer_declined · arrived_store · waiting_time · picked_up · delivered(verification) · earnings_viewed
Add new events here in the same PR that emits them.

Emitted as of M0 (server): user.registered · user.role_granted (identity-kyc, via outbox).
Emitted as of M1 (server): config.micro_market_changed (analytics-config) · merchant.created · merchant.submitted · merchant.approved · merchant.rejected · merchant.went_live · merchant.staff_added (merchant-catalogue) · merchant.kyc_updated (identity-kyc KycService). Every ops action also writes an audit_events row (GET /v1/ops/audit).
Client (merchant app, M1): onboarding_step_completed(step) · kyc_result(kind, status) — sent to PostHog once the SDK is wired (see ADR-006).
