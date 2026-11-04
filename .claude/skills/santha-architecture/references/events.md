# Domain events (v1)
Naming: `<aggregate>.<past_tense_verb>`, snake_case, versioned payload (`v: 1`), always includes `event_id`, `occurred_at`, `micro_market_id`, actor.

identity: user.registered · user.role_granted
merchant: merchant.created · merchant.updated · merchant.kyc_updated · merchant.submitted · merchant.approved · merchant.rejected · merchant.went_live · merchant.availability_changed · merchant.auto_paused · merchant.staff_added · merchant.catalogue_confirmed · merchant.catalogue_went_stale · merchant.slots_updated
catalogue: item.created · item.updated · item.price_changed · item.stock_changed · item.deleted · item.approved (merchant approved an assisted item) · item.released / item.rejected (ops QA on held items) · media.uploaded · media.approved · media.rejected (every catalogue payload carries merchant_id)
orders: order.created (awaiting payment) · order.payment_failed · order.placed · order.accepted · order.rejected · order.expired · order.item_substituted · order.item_removed · order.preparing · order.ready · order.out_for_delivery · order.delivered · order.cancelled · delivery.failed
fulfilment: fulfilment.requested · fulfilment.offered · fulfilment.offer_declined · fulfilment.assigned · fulfilment.fallback_triggered · fulfilment.picked_up · fulfilment.proof_captured
payments: payment.intent_created · payment.captured · payment.failed · refund.requested · refund.issued · wallet.credited
settlement: settlement.run_completed · payout.transferred · payout.failed · reconciliation.exception
trust: issue.reported · issue.resolved · rating.submitted · rating.moderated (both carry merchant_id; the search indexer rebuilds the store) · listing.moderation_flagged · trust_score.changed
rider: rider.online · rider.offline · rider.location_updated (not persisted beyond 24 h)
config: config.micro_market_changed · config.city_coverage_changed · flag.changed
audit: audit.action (ops mutations)

Consumers: notifications (most order/fulfilment events), analytics (all), settlement (order.delivered, refund.issued), search (item.*, media.approved|rejected, merchant.went_live|updated|catalogue_confirmed|slots_updated), trust (order.*, issue.*).
