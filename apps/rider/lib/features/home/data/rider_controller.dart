import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

final riderApiProvider = Provider<RiderApi>((ref) => RiderApi(ref.watch(apiClientProvider)));

/// Current position, or null when location is off / not allowed. Tests override it.
typedef LocationSource = Future<Point?> Function();

final locationSourceProvider = Provider<LocationSource>((ref) => () async {
      try {
        if (!await Geolocator.isLocationServiceEnabled()) return null;
        var p = await Geolocator.checkPermission();
        if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
        if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return null;
        final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
        return Point(pos.latitude, pos.longitude);
      } catch (_) {
        return null;
      }
    });

/// How often the home refreshes (offers, jobs) and the position is sent while online. Tests: null.
final riderPollEveryProvider = Provider<Duration?>((ref) => const Duration(seconds: 10));

/// Wall clock for the offer countdown; tests override with a fixed instant.
final riderNowProvider = StreamProvider<DateTime>((ref) => Stream.periodic(const Duration(seconds: 1), (_) => DateTime.now()));

/// Rings for a new offer. Tests count instead.
final offerAlertProvider = Provider<void Function()>((ref) => () {
      SystemSound.play(SystemSoundType.alert);
      HapticFeedback.heavyImpact();
    });

/// The rider's home: profile, today, the open offer and active jobs. While online it polls and sends the
/// position every 10 s; realtime `offer.new` / `job.updated` refresh at once.
final riderHomeProvider = AsyncNotifierProvider<RiderHomeController, RiderHome>(RiderHomeController.new);

class RiderHomeController extends AsyncNotifier<RiderHome> {
  RiderApi get _api => ref.read(riderApiProvider);
  Analytics get _analytics => ref.read(analyticsProvider);
  Timer? _tick;
  String? _rungFor;
  bool _locationOff = false;

  /// True when the last attempt to read the position failed (show a hint).
  bool get locationOff => _locationOff;

  @override
  Future<RiderHome> build() async {
    final every = ref.watch(riderPollEveryProvider);
    if (every != null) {
      _tick = Timer.periodic(every, (_) => _heartbeat());
      ref.onDispose(() => _tick?.cancel());
    }
    ref.listen(realtimeEventsProvider, (_, next) {
      final name = next.value?.name;
      if (name == 'offer.new' || name == 'offer.withdrawn' || name == 'job.updated') reload();
    });
    final home = await _api.home();
    _ring(home);
    return home;
  }

  void _ring(RiderHome h) {
    final id = h.offer?.id;
    if (id != null && id != _rungFor) {
      _rungFor = id;
      ref.read(offerAlertProvider)();
    }
  }

  Future<void> _heartbeat() async {
    if (state.value?.online != true) return;
    await sendLocation();
    await reload();
  }

  Future<void> sendLocation() async {
    final p = await ref.read(locationSourceProvider)();
    _locationOff = p == null;
    if (p != null) await _api.sendLocation(p.lat, p.lng).catchError((_) {});
  }

  Future<void> reload() async {
    final next = await AsyncValue.guard(_api.home);
    if (next.hasValue) _ring(next.value!);
    if (next.hasValue || state.value == null) state = next;
  }

  Future<void> goOnline(List<String> zones) async {
    final h = await _api.setStatus(online: true, zones: zones);
    state = AsyncData(h);
    _analytics.track('online_toggled', {'online': true, 'zones': zones.length});
    await sendLocation();
    await reload();
  }

  Future<void> goOffline() async {
    state = AsyncData(await _api.setStatus(online: false));
    _analytics.track('online_toggled', {'online': false});
  }

  Future<Job> accept(RiderOffer o) async {
    try {
      final job = await _api.accept(o.id);
      _analytics.track('offer_accepted', {'offer_id': o.id, 'pay_paise': o.payPaise});
      return job;
    } finally {
      await reload();
    }
  }

  Future<void> decline(RiderOffer o) async {
    await _api.decline(o.id);
    _analytics.track('offer_declined', {'offer_id': o.id});
    await reload();
  }
}

/// One job, refreshed by realtime `job.updated` (e.g. the store marked it ready).
final jobProvider = AsyncNotifierProvider.family<JobController, Job, String>(JobController.new);

class JobController extends AsyncNotifier<Job> {
  JobController(this.id);
  final String id;
  RiderApi get _api => ref.read(riderApiProvider);
  Analytics get _analytics => ref.read(analyticsProvider);

  @override
  Future<Job> build() async {
    ref.listen(realtimeEventsProvider, (_, next) {
      if (next.value?.name == 'job.updated' && next.value?.data['fulfilmentId'] == id) reload();
    });
    return _api.job(id);
  }

  Future<void> reload() async {
    final next = await AsyncValue.guard(() => _api.job(id));
    if (next.hasValue) state = next;
  }

  Future<void> arrived() async => state = AsyncData(await _api.arrived(id));

  Future<void> pickedUp(String code) async {
    state = AsyncData(await _api.pickedUp(id, code));
    _analytics.track('picked_up', {'job_id': id});
  }

  Future<void> delivered(String otp, int? codPaise) async {
    state = AsyncData(await _api.delivered(id, otp: otp, codCollectedPaise: codPaise));
    _analytics.track('delivered', {'job_id': id, 'verification': 'otp', 'cod_paise': codPaise ?? 0});
    ref.invalidate(riderHomeProvider);
  }
}

final earningsProvider = FutureProvider.autoDispose<RiderEarnings>((ref) => ref.watch(riderApiProvider).earnings());
