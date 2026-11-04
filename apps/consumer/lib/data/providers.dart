import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_offline/santha_offline.dart';

final discoveryApiProvider = Provider<DiscoveryApi>((ref) => DiscoveryApi(ref.watch(apiClientProvider)));
final addressApiProvider = Provider<AddressApi>((ref) => AddressApi(ref.watch(apiClientProvider)));

/// Where the last-seen feed and store pages are kept for offline use (ADR-009). Tests override it.
final jsonCacheProvider = FutureProvider<JsonCache>((ref) async {
  final base = await getApplicationCacheDirectory();
  return JsonCache(FileCacheStorage(Directory('${base.path}${Platform.pathSeparator}santha_catalogue')));
});

/// Absolute URL for API-relative media paths (`/v1/dev/media/...` in dev, CDN URLs otherwise).
final mediaUrlProvider = Provider<String? Function(String?)>((ref) {
  final client = ref.watch(apiClientProvider);
  return (url) => url == null ? null : client.resolve(url);
});

/// Device location (GPS), behind an interface so tests and the fake flow need no plugin.
abstract interface class DeviceLocator {
  Future<LocateResult> locate();
}

sealed class LocateResult {
  const LocateResult();
}

class Located extends LocateResult {
  const Located(this.point, {this.accuracyM, this.precise = true});
  final LatLng point;

  /// Estimated error radius in metres (null when unknown, e.g. tests).
  final double? accuracyM;

  /// False when the user allowed only approximate location (Android 12+ / iOS 14+).
  final bool precise;

  /// Good enough to drop the pin without the user checking it on the map.
  bool get trustworthy => precise && (accuracyM ?? 0) <= Located.goodAccuracyM;
  static const goodAccuracyM = 30.0;
}

class LocationServiceOff extends LocateResult {
  const LocationServiceOff();
}

class LocationDenied extends LocateResult {
  const LocationDenied();
}

/// GPS gave no fix in time.
class LocationUnavailable extends LocateResult {
  const LocationUnavailable();
}

final checkoutApiProvider = Provider<CheckoutApi>((ref) => CheckoutApi(ref.watch(apiClientProvider)));
