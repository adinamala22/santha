import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import '../../../l10n/gen/app_localizations.dart';

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

/// Positions while online, kept alive when the rider switches to Google Maps or locks the phone: an Android
/// foreground service with a visible notification, iOS background location updates (review G3). Tests: null.
typedef LiveLocations = Stream<Point> Function(AppLocalizations l);

final liveLocationsProvider = Provider<LiveLocations?>((ref) => (l) {
      final LocationSettings settings = switch (defaultTargetPlatform) {
        TargetPlatform.android => AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 20,
            intervalDuration: const Duration(seconds: 10),
            foregroundNotificationConfig: ForegroundNotificationConfig(
              notificationTitle: l.liveLocationTitle,
              notificationText: l.liveLocationText,
              notificationChannelName: l.liveLocationChannel,
              enableWakeLock: true,
              setOngoing: true,
            ),
          ),
        TargetPlatform.iOS => AppleSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 20,
            activityType: ActivityType.otherNavigation,
            pauseLocationUpdatesAutomatically: false,
            allowBackgroundLocationUpdates: true,
            showBackgroundLocationIndicator: true,
          ),
        _ => const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 20),
      };
      return Geolocator.getPositionStream(locationSettings: settings).map((p) => Point(p.latitude, p.longitude));
    });

/// A photo taken with the camera (ADR-030). Tests override [photoTakerProvider].
class PickedPhoto {
  const PickedPhoto(this.bytes, this.contentType);
  final Uint8List bytes;
  final String contentType;
}

typedef PhotoTaker = Future<PickedPhoto?> Function({bool front});

/// Camera only (no gallery): sign-up selfie (front camera), licence card and door photos (back camera).
final photoTakerProvider = Provider<PhotoTaker>((ref) => ({bool front = false}) async {
      final x = await ImagePicker().pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: front ? CameraDevice.front : CameraDevice.rear,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 80,
      );
      if (x == null) return null;
      final name = x.name.toLowerCase();
      return PickedPhoto(await x.readAsBytes(), x.mimeType ?? (name.endsWith('.png') ? 'image/png' : 'image/jpeg'));
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

/// True when the last attempt to read the position failed (the home shows a hint).
final riderLocationOffProvider = NotifierProvider<RiderLocationOff, bool>(RiderLocationOff.new);

class RiderLocationOff extends Notifier<bool> {
  @override
  bool build() => false;
  void set(bool off) => state = off;
}

/// The rider's home: profile, today, the open offer and active jobs. While online it polls and sends the
/// position every 10 s; realtime `offer.new` / `job.updated` refresh at once.
final riderHomeProvider = AsyncNotifierProvider<RiderHomeController, RiderHome>(RiderHomeController.new);

class RiderHomeController extends AsyncNotifier<RiderHome> {
  RiderApi get _api => ref.read(riderApiProvider);
  Analytics get _analytics => ref.read(analyticsProvider);
  Timer? _tick;
  String? _rungFor;
  StreamSubscription<Point>? _live;
  DateTime? _lastSent;

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
    ref.onDispose(_stopLive);
    final home = await _api.home();
    _ring(home);
    _syncLive(home);
    return home;
  }

  /// Online → the background position stream runs; offline → it stops (and its notification goes away).
  void _syncLive(RiderHome h) {
    if (h.online && _live == null) {
      final source = ref.read(liveLocationsProvider);
      if (source == null) return;
      final l = lookupAppLocalizations(ref.read(localeControllerProvider));
      _live = source(l).listen(_onFix, onError: (Object _) {
        ref.read(riderLocationOffProvider.notifier).set(true);
        _stopLive(); // try again on the next refresh (e.g. after the rider allows location)
      });
    } else if (!h.online) {
      _stopLive();
    }
  }

  void _stopLive() {
    _live?.cancel();
    _live = null;
  }

  /// At most one position every 10 s reaches the server (live tracking, dispatch).
  Future<void> _onFix(Point p) async {
    if (ref.read(riderLocationOffProvider)) ref.read(riderLocationOffProvider.notifier).set(false);
    final now = DateTime.now();
    if (_lastSent != null && now.difference(_lastSent!) < const Duration(seconds: 10)) return;
    _lastSent = now;
    await _api.sendLocation(p.lat, p.lng).catchError((_) {});
  }

  void _ring(RiderHome h) {
    final id = h.offer?.id;
    if (id != null && id != _rungFor) {
      _rungFor = id;
      ref.read(offerAlertProvider)();
      _analytics.track('offer_shown', {'offer_id': id, 'pay_paise': h.offer!.payPaise});
    }
  }

  Future<void> _heartbeat() async {
    if (state.value?.online != true) return;
    if (_live == null) await sendLocation(); // the background stream sends its own positions
    await reload();
  }

  Future<void> sendLocation() async {
    final p = await ref.read(locationSourceProvider)();
    ref.read(riderLocationOffProvider.notifier).set(p == null);
    if (p != null) await _api.sendLocation(p.lat, p.lng).catchError((_) {});
  }

  Future<void> reload() async {
    final next = await AsyncValue.guard(_api.home);
    if (next.hasValue) {
      _ring(next.value!);
      _syncLive(next.value!);
    }
    if (next.hasValue || state.value == null) state = next;
  }

  Future<void> goOnline(List<String> zones) async {
    final h = await _api.setStatus(online: true, zones: zones);
    state = AsyncData(h);
    _syncLive(h);
    _analytics.track('online_toggled', {'online': true, 'zones': zones.length});
    await sendLocation();
    await reload();
  }

  Future<void> goOffline() async {
    final h = await _api.setStatus(online: false);
    state = AsyncData(h);
    _syncLive(h);
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

  Future<void> arrived() async {
    state = AsyncData(await _api.arrived(id));
    _analytics.track('arrived_store', {'job_id': id});
  }

  Future<void> pickedUp(String code) async {
    state = AsyncData(await _api.pickedUp(id, code));
    _analytics.track('picked_up', {'job_id': id});
  }

  /// At the customer's door (ADR-030): the customer is told; the waiting timer starts.
  Future<void> arrivedDrop() async {
    state = AsyncData(await _api.arrivedDrop(id));
    _analytics.track('arrived_customer', {'job_id': id});
  }

  /// Left at the door with a photo instead of the OTP (prepaid orders, after arriving; ADR-030).
  Future<void> deliveredWithPhoto(PickedPhoto p) async {
    final photoId = await _api.uploadPhoto(p.bytes, kind: 'delivery', contentType: p.contentType, fulfilmentId: id);
    state = AsyncData(await _api.deliveredWithPhoto(id, photoId));
    _analytics.track('delivered', {'job_id': id, 'verification': 'photo', 'cod_paise': 0});
    ref.invalidate(riderHomeProvider);
  }

  /// Couldn't deliver (ADR-026): the job stays with the rider until they retry or support decides.
  Future<void> failed(FailedReason reason, String? note) async {
    state = AsyncData(await _api.failed(id, reason, note: note));
    _analytics.track('delivery_failed', {'job_id': id, 'reason': reason.wire, 'has_note': (note ?? '').trim().isNotEmpty});
    ref.invalidate(riderHomeProvider);
  }

  /// The customer called back: on the way again.
  Future<void> retry() async {
    state = AsyncData(await _api.retry(id));
    _analytics.track('delivery_retried', {'job_id': id, 'by': 'rider'});
    ref.invalidate(riderHomeProvider);
  }

  Future<void> delivered(String otp, int? codPaise) async {
    state = AsyncData(await _api.delivered(id, otp: otp, codCollectedPaise: codPaise));
    _analytics.track('delivered', {'job_id': id, 'verification': 'otp', 'cod_paise': codPaise ?? 0});
    ref.invalidate(riderHomeProvider);
  }
}

final earningsProvider = FutureProvider.autoDispose<RiderEarnings>((ref) {
  ref.read(analyticsProvider).track('earnings_viewed', {});
  return ref.watch(riderApiProvider).earnings();
});

/// The last 7 IST days (ADR-031).
final weekProvider = FutureProvider.autoDispose<RiderWeek>((ref) => ref.watch(riderApiProvider).earningsWeek());

final payoutsProvider = FutureProvider.autoDispose<List<Payout>>((ref) => ref.watch(riderApiProvider).payouts());
