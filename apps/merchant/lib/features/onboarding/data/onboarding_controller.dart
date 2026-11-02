import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import '../../catalogue/data/catalogue_controller.dart';

final merchantApiProvider = Provider<MerchantApi>((ref) => MerchantApi(ref.watch(apiClientProvider)));

/// The signed-in owner's store (null = not started). Every mutation refreshes it from the server,
/// because the checklist and `canSubmit` are computed there.
final onboardingProvider = AsyncNotifierProvider<OnboardingController, MerchantView?>(OnboardingController.new);

class OnboardingController extends AsyncNotifier<MerchantView?> {
  MerchantApi get _api => ref.read(merchantApiProvider);
  Analytics get _analytics => ref.read(analyticsProvider);

  @override
  Future<MerchantView?> build() => _api.mine();

  /// Re-fetches without dropping the current screen (pull-to-refresh).
  Future<void> reload() async {
    state = await AsyncValue.guard(_api.mine);
  }

  Future<MerchantView> create({required MerchantType type, required String name, bool? sellsFood, String? category}) async {
    final v = await _api.create(type: type, name: name, sellsFood: sellsFood, category: category);
    _analytics.track('onboarding_step_completed', {'step': 'business_type', 'type': type.wire});
    state = AsyncData(v);
    return v;
  }

  /// PATCH /merchants/me; [step] names the analytics step.
  Future<MerchantView> save(Map<String, Object?> patch, {required String step}) async {
    final v = await _api.update(patch);
    _analytics.track('onboarding_step_completed', {'step': step});
    state = AsyncData(v);
    return v;
  }

  /// Runs one KYC call, records the result, and refreshes the checklist.
  Future<KycCheck> kyc(Future<KycCheck> Function(MerchantApi api) call) async {
    final c = await call(_api);
    _analytics.track('kyc_result', {'kind': c.kind.wire, 'status': c.status.name});
    state = AsyncData(await _api.mine());
    return c;
  }

  Future<void> addStaff({required String name, required String phone}) async {
    await _api.addStaff(name: name, phone: phone);
    state = AsyncData(await _api.mine());
  }

  Future<void> removeStaff(String id) async {
    await _api.removeStaff(id);
    state = AsyncData(await _api.mine());
  }

  /// Store photos in display order (step `photos`).
  Future<MerchantView> setPhotos(List<String> mediaIds) async {
    final v = await ref.read(catalogueApiProvider).setStorePhotos(mediaIds);
    state = AsyncData(v);
    return v;
  }

  Future<MerchantView> submit() async {
    final v = await _api.submit();
    _analytics.track('onboarding_step_completed', {'step': 'submitted'});
    state = AsyncData(v);
    return v;
  }
}

/// Device location for placing the shop. Behind a provider so tests can fake it.
sealed class LocationResult {}

class LocationOk extends LocationResult {
  LocationOk(this.lat, this.lng);
  final double lat;
  final double lng;
}

class LocationDenied extends LocationResult {}

class LocationServiceOff extends LocationResult {}

typedef LocationReader = Future<LocationResult> Function();

final locationReaderProvider = Provider<LocationReader>((ref) => () async {
      if (!await Geolocator.isLocationServiceEnabled()) return LocationServiceOff();
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
      if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return LocationDenied();
      final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
      return LocationOk(pos.latitude, pos.longitude);
    });
