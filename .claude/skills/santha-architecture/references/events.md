# Domain events (v1)
Naming: `<aggregate>.<past_tense_verb>`, snake_case, versioned payload (`v: 1`), always includes `event_id`, `occurred_at`, `micro_market_id`, actor.

identity: user.registered · user.role_granted
merchant: merchant.created · merchant.kyc_updated · merchant.went_live · merchant.availability_changed · merchant.auto_paused · merchant.staff_added
catalogue: item.created · item.updated · item.stock_changed · item.flagged · menu.slot_changed
orders: order.placed · order.accepted · order.rejected · order.item_substituted · order.item_removed · order.preparing · order.ready · order.out_for_delivery · order.delivered · order.cancelled · delivery.failed
fulfilment: fulfilment.requested · fulfilment.offered · fulfilment.offer_declined · fulfilment.assigned · fulfilment.fallback_triggered · fulfilment.picked_up · fulfilment.proof_captured
payments: payment.intent_created · payment.captured · payment.failed · refund.requested · refund.issued · wallet.credited
settlement: settlement.run_completed · payout.transferred · payout.failed · reconciliation.exception
trust: issue.reported · issue.resolved · rating.submitted · listing.moderation_flagged · trust_score.changed
rider: rider.online · rider.offline · rider.location_updated (not persisted beyond 24 h)
config: config.micro_market_changed · flag.changed
audit: audit.action (ops mutations)

Consumers: notifications (most order/fulfilment events), analytics (all), settlement (order.delivered, refund.issued), search (item.*, merchant.availability_changed), trust (order.*, issue.*).
