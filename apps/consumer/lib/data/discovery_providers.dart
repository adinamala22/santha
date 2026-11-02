import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_offline/santha_offline.dart';

import '../features/location/location_controller.dart';
import 'providers.dart';

/// Failures surface immediately with a "Try again" button (and the offline cache) instead of
/// Riverpod's silent automatic retries.
Duration? _noRetry(int retryCount, Object error) => null;

/// Points ~100 m apart share cache entries.
String _cell(LatLng p) => '${p.lat.toStringAsFixed(3)},${p.lng.toStringAsFixed(3)}';

/// Home feed for one tab. Network first, cached copy (with its age) when offline.
final feedProvider = FutureProvider.autoDispose.family<Cached<Feed>, FeedTab>(retry: _noRetry, (ref, tab) async {
  final loc = ref.watch(deliveryPointProvider);
  if (loc == null) throw StateError('no delivery location');
  final cache = await ref.watch(jsonCacheProvider.future);
  final api = ref.watch(discoveryApiProvider);
  final r = await cache.fetch('feed:${tab.wire}:${_cell(loc.point)}', () => api.feedJson(loc.point, tab: tab), (j) => Feed.fromJson(j! as Json));
  ref.read(analyticsProvider).track('feed_viewed', {
    'tab': tab.wire,
    'store_count': r.value.stores.length,
    'micro_market': r.value.serviceability.microMarket?.slug,
    'from_cache': !r.fresh,
  });
  return r;
});

/// Store / home-kitchen page, cached for offline browsing (ADR-009).
final storePageProvider = FutureProvider.autoDispose.family<Cached<StorePage>, String>(retry: _noRetry, (ref, id) async {
  final loc = ref.watch(deliveryPointProvider);
  if (loc == null) throw StateError('no delivery location');
  final cache = await ref.watch(jsonCacheProvider.future);
  final api = ref.watch(discoveryApiProvider);
  final r = await cache.fetch('store:$id:${_cell(loc.point)}', () => api.storeJson(id, loc.point), (j) => StorePage.fromJson(j! as Json));
  ref.read(analyticsProvider).track('merchant_viewed', {
    'merchant_id': id,
    'type': r.value.store.type.wire,
    'delivers_here': r.value.deliversHere,
    'from_cache': !r.fresh,
  });
  return r;
});

typedef SearchQuery = ({String q, String? category});

/// Search needs the network (results depend on live stock and ETA); no offline copy.
final searchProvider = FutureProvider.autoDispose.family<SearchResult, SearchQuery>(retry: _noRetry, (ref, query) async {
  final loc = ref.watch(deliveryPointProvider);
  if (loc == null) throw StateError('no delivery location');
  final sw = Stopwatch()..start();
  final r = await ref.watch(discoveryApiProvider).search(loc.point, q: query.q, category: query.category);
  ref.read(analyticsProvider).track('search_performed', {
    'query': query.q,
    'category': query.category,
    'results': r.totalItems,
    'store_groups': r.groups.length,
    'zero_result': r.zeroResult,
    'latency_ms': sw.elapsedMilliseconds,
  });
  return r;
});

/// Saved addresses (signed in).
final addressesProvider = FutureProvider.autoDispose<List<Address>>(retry: _noRetry, (ref) => ref.watch(addressApiProvider).list());
