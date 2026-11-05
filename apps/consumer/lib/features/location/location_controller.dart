import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import '../../data/providers.dart';

enum LocationSource { gps, pin, address }

/// The point we deliver to, how it was chosen, and whether Santha serves it.
class DeliveryLocation {
  const DeliveryLocation({required this.point, required this.source, required this.serviceability, this.address});

  factory DeliveryLocation.fromJson(Json j) => DeliveryLocation(
        point: LatLng.fromJson(j['point'] as Json),
        source: LocationSource.values.byName(j['source'] as String),
        serviceability: Serviceability.fromJson(j['serviceability'] as Json),
        address: j['address'] == null ? null : (id: j['address']['id'] as String, label: AddressLabel.values.byName(j['address']['label'] as String), line: j['address']['line'] as String),
      );

  final LatLng point;
  final LocationSource source;
  final Serviceability serviceability;
  final ({String id, AddressLabel label, String line})? address;

  bool get serviceable => serviceability.serviceable;

  Json toJson() => {
        'point': point.toJson(),
        'source': source.name,
        'serviceability': serviceability.toJson(),
        'address': address == null ? null : {'id': address!.id, 'label': address!.label.name, 'line': address!.line},
      };
}

sealed class LocationState {
  const LocationState();
}

class LocationRestoring extends LocationState {
  const LocationRestoring();
}

class LocationUnset extends LocationState {
  const LocationUnset();
}

class LocationSet extends LocationState {
  const LocationSet(this.location);
  final DeliveryLocation location;
}

final deviceLocatorProvider = Provider<DeviceLocator>((ref) => GeolocatorLocator());

/// Delivery location: restored from the device on start, set from GPS, a map pin or a saved
/// address; each change re-checks serviceability (FR-LOC-1).
final locationControllerProvider = NotifierProvider<LocationController, LocationState>(LocationController.new);

class LocationController extends Notifier<LocationState> {
  static const _key = 'santha.location';

  /// Bumped by [forget]: a restore still reading from storage must not bring the old location back.
  int _epoch = 0;

  @override
  LocationState build() {
    _restore();
    return const LocationRestoring();
  }

  Future<void> _restore() async {
    final epoch = _epoch;
    final raw = await ref.read(keyValueStoreProvider).read(_key);
    if (epoch != _epoch) return;
    if (raw == null) {
      state = const LocationUnset();
      return;
    }
    try {
      state = LocationSet(DeliveryLocation.fromJson(jsonDecode(raw) as Json));
    } catch (_) {
      state = const LocationUnset();
    }
  }

  /// A GPS fix (or why there is none). It is not used until the customer confirms it on the map pin,
  /// because phone fixes can be tens to hundreds of metres off.
  Future<LocateResult> locateDevice() => ref.read(deviceLocatorProvider).locate();

  /// Signed out: the next person on this phone chooses their own delivery location.
  Future<void> forget() async {
    _epoch++;
    state = const LocationUnset();
    await ref.read(keyValueStoreProvider).delete(_key);
  }

  /// The saved address behind the delivery location was deleted: keep the point, drop the address.
  Future<void> detachAddress(String addressId) async {
    final s = state;
    if (s is! LocationSet || s.location.address?.id != addressId) return;
    final loc = DeliveryLocation(point: s.location.point, source: LocationSource.pin, serviceability: s.location.serviceability);
    state = LocationSet(loc);
    await ref.read(keyValueStoreProvider).write(_key, jsonEncode(loc.toJson()));
  }

  Future<DeliveryLocation> useAddress(Address a) => set(a.location, LocationSource.address, address: a);

  /// Throws [ApiException] when the serviceability check fails (network): the UI keeps its state.
  Future<DeliveryLocation> set(LatLng point, LocationSource source, {Address? address}) async {
    final s = await ref.read(discoveryApiProvider).serviceability(point);
    final loc = DeliveryLocation(
      point: point,
      source: source,
      serviceability: s.serviceability,
      address: address == null ? null : (id: address.id, label: address.label, line: address.line),
    );
    final analytics = ref.read(analyticsProvider);
    analytics.track('location_set', {'source': source.name});
    analytics.track('serviceability_result', {
      'serviceable': s.serviceability.serviceable,
      'micro_market': s.serviceability.microMarket?.slug,
      'waitlist': s.waitlist,
    });
    await ref.read(keyValueStoreProvider).write(_key, jsonEncode(loc.toJson()));
    state = LocationSet(loc);
    return loc;
  }
}

/// The current point, or null before a location is chosen. Discovery providers watch this.
final deliveryPointProvider = Provider<DeliveryLocation?>((ref) {
  final s = ref.watch(locationControllerProvider);
  return s is LocationSet ? s.location : null;
});

/// GPS with an accuracy check. The first fix a phone reports is often a cached or network position
/// hundreds of metres off, so we listen for up to [_maxWait], ignore stale fixes and keep the most accurate
/// one, stopping early once it is within [_goodEnoughM]. The caller still lets the user adjust the pin.
class GeolocatorLocator implements DeviceLocator {
  static const _maxWait = Duration(seconds: 12);
  static const _goodEnoughM = 20.0;
  static const _maxAge = Duration(minutes: 1);

  @override
  Future<LocateResult> locate() async {
    if (!await Geolocator.isLocationServiceEnabled()) return const LocationServiceOff();
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return const LocationDenied();
    var precise = true;
    try {
      precise = await Geolocator.getLocationAccuracy() == LocationAccuracyStatus.precise;
    } catch (_) {}

    Position? best;
    final deadline = DateTime.now().add(_maxWait);
    try {
      final fixes = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, distanceFilter: 0));
      await for (final pos in fixes.timeout(_maxWait)) {
        final fresh = DateTime.now().difference(pos.timestamp) <= _maxAge;
        if (fresh && (best == null || pos.accuracy < best.accuracy)) best = pos;
        if ((best != null && best.accuracy <= _goodEnoughM) || DateTime.now().isAfter(deadline)) break;
      }
    } on TimeoutException {
      // keep the best fix so far
    } catch (_) {}
    best ??= await Geolocator.getLastKnownPosition().catchError((_) => null);
    if (best == null) return const LocationUnavailable();
    return Located(LatLng(best.latitude, best.longitude), accuracyM: best.accuracy, precise: precise);
  }
}
