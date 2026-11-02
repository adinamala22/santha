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

  @override
  LocationState build() {
    _restore();
    return const LocationRestoring();
  }

  Future<void> _restore() async {
    final raw = await ref.read(keyValueStoreProvider).read(_key);
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

  /// GPS → serviceability. Returns the failure (service off / denied) for the UI to explain.
  Future<LocateResult> useDeviceLocation() async {
    final r = await ref.read(deviceLocatorProvider).locate();
    if (r is Located) await set(r.point, LocationSource.gps);
    return r;
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

class GeolocatorLocator implements DeviceLocator {
  @override
  Future<LocateResult> locate() async {
    if (!await Geolocator.isLocationServiceEnabled()) return const LocationServiceOff();
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return const LocationDenied();
    final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
    return Located(LatLng(pos.latitude, pos.longitude));
  }
}
