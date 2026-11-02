/// Offline support. M3: [JsonCache], a small file-backed cache of API responses so the consumer
/// app can show the last catalogue it saw (with a stale indicator) when the network is gone
/// (ADR-009). The merchant action queue (Drift) arrives with M5.
/// Conflict rules (M5): server wins on order state; client wins on stock toggles made ≤2 min ago.
library;

export 'src/json_cache.dart';
