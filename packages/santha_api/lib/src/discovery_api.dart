import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'discovery_models.dart';
import 'merchant_models.dart';
import 'models.dart';

/// Consumer discovery: home feed, search, store pages (public — browsing works before sign-in).
/// Raw JSON variants exist so the app can cache responses offline and re-parse them later.
class DiscoveryApi {
  DiscoveryApi(this.client);
  final SanthaApiClient client;
  Dio get _dio => client.dio;

  /// Is this point inside a live micro-market? (`waitlist`: show the join-waitlist card.)
  Future<({Serviceability serviceability, bool waitlist})> serviceability(LatLng at) => _call(() async {
        final r = await _dio.get<Json>('/v1/serviceability', queryParameters: _at(at));
        return (serviceability: Serviceability.fromJson(r.data!), waitlist: r.data!['waitlist'] as bool? ?? false);
      });

  Future<Feed> feed(LatLng at, {FeedTab tab = FeedTab.stores, bool openNow = false, bool selfDelivered = false, int? maxEta}) async =>
      Feed.fromJson(await feedJson(at, tab: tab, openNow: openNow, selfDelivered: selfDelivered, maxEta: maxEta));

  Future<Json> feedJson(LatLng at, {FeedTab tab = FeedTab.stores, bool openNow = false, bool selfDelivered = false, int? maxEta}) => _call(() async {
        final r = await _dio.get<Json>('/v1/feed', queryParameters: {
          ..._at(at),
          'tab': tab.wire,
          if (openNow) 'openNow': 'true',
          if (selfDelivered) 'selfDelivered': 'true',
          'maxEta': ?maxEta,
        });
        return r.data!;
      });

  /// Free-text search, or category browse when [q] is empty and [category] is set.
  Future<SearchResult> search(LatLng at, {String q = '', String? category, bool vegOnly = false, bool openNow = false}) => _call(() async {
        final r = await _dio.get<Json>('/v1/search', queryParameters: {
          ..._at(at),
          if (q.trim().isNotEmpty) 'q': q.trim(),
          'category': ?category,
          if (vegOnly) 'veg': 'true',
          if (openNow) 'openNow': 'true',
        });
        return SearchResult.fromJson(r.data!);
      });

  Future<Json> storeJson(String id, LatLng at) => _call(() async => (await _dio.get<Json>('/v1/stores/$id', queryParameters: _at(at))).data!);

  Future<StorePage> store(String id, LatLng at) async => StorePage.fromJson(await storeJson(id, at));

  static Map<String, Object> _at(LatLng p) => {'lat': p.lat, 'lng': p.lng};
}

/// Saved delivery addresses (`/v1/me/addresses`, signed in).
class AddressApi {
  AddressApi(this.client);
  final SanthaApiClient client;
  Dio get _dio => client.dio;

  Future<List<Address>> list() => _call(() async {
        final r = await _dio.get<Json>('/v1/me/addresses');
        return (r.data!['items'] as List).map((a) => Address.fromJson(a as Json)).toList();
      });

  Future<Address> create(AddressInput a) => _call(() async => Address.fromJson((await _dio.post<Json>('/v1/me/addresses', data: a.toJson())).data!));

  Future<Address> update(String id, Json patch) => _call(() async => Address.fromJson((await _dio.patch<Json>('/v1/me/addresses/$id', data: patch)).data!));

  Future<Address> makeDefault(String id) => update(id, {'isDefault': true});

  Future<void> remove(String id) => _call(() => _dio.delete<void>('/v1/me/addresses/$id'));
}

Future<T> _call<T>(Future<T> Function() fn) async {
  try {
    return await fn();
  } on DioException catch (e) {
    throw ApiException.fromDio(e);
  }
}
