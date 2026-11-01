/// Offline cache and sync queue (Drift). Scaffolded in M0; implemented with the consumer
/// catalogue cache (M3) and merchant order actions (M5).
/// Conflict rules: server wins on order state; client wins on stock toggles made ≤2 min ago.
library;
