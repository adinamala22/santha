# Order state machine
Before the lifecycle (online payment, ADR-010): AWAITING_PAYMENT → PLACED (payment captured, system) | PAYMENT_FAILED (window passed or customer gave up). COD orders start in PLACED.
States: PLACED → ACCEPTED → PREPARING → READY → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
Terminal: CANCELLED (actor: customer|merchant|platform, reason code), FAILED_DELIVERY (re-attempt or refund), REJECTED/EXPIRED (merchant; two misses → merchant.auto_paused)

Legal transitions:
PLACED → ACCEPTED | REJECTED | EXPIRED | CANCELLED(customer, free)
ACCEPTED → PREPARING | CANCELLED(customer, fee rules; cooked food non-cancellable once PREPARING) | CANCELLED(merchant, reason)
PREPARING → READY | CANCELLED(merchant: all items unavailable)
READY → PICKED_UP
PICKED_UP → OUT_FOR_DELIVERY (immediate for single order; after second pickup when batched)
OUT_FOR_DELIVERY → DELIVERED | FAILED_DELIVERY
FAILED_DELIVERY → OUT_FOR_DELIVERY (re-attempt) | CANCELLED(platform, refund)

Timers: accept window (merchant config, default 20 s UI / 120 s hard) · pack SLA (prep p80 + 5 min) · pickup wait · issue windows (2 h cooked, 24 h retail, 48 h fashion return)
Side effects on transition: cancel timers, emit event, recompute ETA, notify, update merchant metrics, trigger refunds for removed items.
