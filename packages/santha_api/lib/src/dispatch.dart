// Dispatch & tracking models and API (M6), mirroring dispatch.dto.ts.
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'merchant_models.dart';
import 'models.dart';
import 'money.dart';

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);

enum DeliveryMode { self, rider, tpl }

enum DeliveryState { searching, assigned, pickedUp, delivered, failed, cancelled }

DeliveryState _state(String s) => s == 'picked_up' ? DeliveryState.pickedUp : DeliveryState.values.byName(s);

enum FallbackStage { none, tpl, selfBonus, standby, customerNotified }

FallbackStage _stage(String s) => switch (s) {
      'self_bonus' => FallbackStage.selfBonus,
      'customer_notified' => FallbackStage.customerNotified,
      _ => FallbackStage.values.byName(s),
    };

enum CourierKind { staff, owner, rider, tpl }

class PayLine {
  const PayLine(this.code, this.amountPaise);
  factory PayLine.fromJson(Json j) => PayLine(j['code'] as String, j['amountPaise'] as int);
  /// base | distance | wait | batch
  final String code;
  final int amountPaise;
}

class Point {
  const Point(this.lat, this.lng);
  factory Point.fromJson(Json j) => Point((j['lat'] as num).toDouble(), (j['lng'] as num).toDouble());
  final double lat;
  final double lng;
}

class Courier {
  const Courier({required this.kind, required this.name, required this.callNumber});
  factory Courier.fromJson(Json j) => Courier(kind: CourierKind.values.byName(j['kind'] as String), name: j['name'] as String, callNumber: j['callNumber'] as String);
  final CourierKind kind;
  final String name;
  /// Masked number (never the courier's real phone).
  final String callNumber;
}

// ───────────── rider ─────────────

class RiderOffer {
  const RiderOffer({
    required this.id,
    required this.expiresAt,
    required this.payPaise,
    required this.payLines,
    required this.storeName,
    required this.pickupDistanceM,
    required this.dropArea,
    required this.dropDistanceM,
    this.readyInMin,
  });
  factory RiderOffer.fromJson(Json j) {
    final p = j['pickup'] as Json;
    final d = j['drop'] as Json;
    return RiderOffer(
      id: j['id'] as String,
      expiresAt: DateTime.parse(j['expiresAt'] as String),
      payPaise: j['payPaise'] as int,
      payLines: (j['payLines'] as List).map((l) => PayLine.fromJson(l as Json)).toList(),
      storeName: p['name'] as String,
      pickupDistanceM: p['distanceM'] as int,
      readyInMin: p['readyInMin'] as int?,
      dropArea: d['area'] as String,
      dropDistanceM: d['distanceM'] as int,
    );
  }
  final String id;
  final DateTime expiresAt;
  final int payPaise;
  final List<PayLine> payLines;
  final String storeName;
  final int pickupDistanceM;
  final int? readyInMin;
  /// Area only; the exact address comes after accepting.
  final String dropArea;
  final int dropDistanceM;
}

class Job {
  const Job({
    required this.id,
    required this.orderId,
    required this.code,
    required this.mode,
    required this.state,
    required this.orderState,
    required this.storeName,
    required this.store,
    required this.dropLine,
    required this.drop,
    required this.itemCount,
    required this.codDuePaise,
    required this.payPaise,
    required this.payLines,
    required this.callNumber,
    required this.pickupCodeRequired,
    this.storeLine,
    this.dropName,
    this.dropLandmark,
    this.instructions,
    this.readyAt,
    this.arrivedAt,
    this.pickedUpAt,
    this.deliveredAt,
    this.failedReason,
    this.failedAt,
    this.arrivedDropAt,
    this.photoProofAllowed = false,
  });
  factory Job.fromJson(Json j) {
    final s = j['store'] as Json;
    final d = j['drop'] as Json;
    return Job(
      id: j['id'] as String,
      orderId: j['orderId'] as String,
      code: j['code'] as String,
      mode: DeliveryMode.values.byName(j['mode'] as String),
      state: _state(j['state'] as String),
      orderState: j['orderState'] as String,
      storeName: s['name'] as String,
      storeLine: s['line'] as String?,
      store: Point.fromJson(s),
      dropName: d['name'] as String?,
      dropLine: d['line'] as String,
      dropLandmark: d['landmark'] as String?,
      drop: Point.fromJson(d),
      instructions: j['instructions'] as String?,
      itemCount: j['itemCount'] as int,
      codDuePaise: j['codDuePaise'] as int,
      payPaise: j['payPaise'] as int,
      payLines: (j['payLines'] as List).map((l) => PayLine.fromJson(l as Json)).toList(),
      callNumber: j['callNumber'] as String,
      readyAt: _date(j['readyAt']),
      arrivedAt: _date(j['arrivedAt']),
      pickedUpAt: _date(j['pickedUpAt']),
      deliveredAt: _date(j['deliveredAt']),
      pickupCodeRequired: j['pickupCodeRequired'] as bool,
      failedReason: j['failedReason'] == null ? null : FailedReason.parse(j['failedReason'] as String),
      failedAt: _date(j['failedAt']),
      arrivedDropAt: _date(j['arrivedDropAt']),
      photoProofAllowed: (j['photoProofAllowed'] as bool?) ?? false,
    );
  }
  final String id;
  final String orderId;
  final String code;
  final DeliveryMode mode;
  final DeliveryState state;
  final String orderState;
  final String storeName;
  final String? storeLine;
  final Point store;
  final String? dropName;
  final String dropLine;
  final String? dropLandmark;
  final Point drop;
  final String? instructions;
  final int itemCount;
  final int codDuePaise;
  final int payPaise;
  final List<PayLine> payLines;
  final String callNumber;
  final DateTime? readyAt;
  final DateTime? arrivedAt;
  final DateTime? pickedUpAt;
  final DateTime? deliveredAt;
  final bool pickupCodeRequired;

  /// Couldn't deliver (ADR-026): why, while the job waits for a retry or for Santha support.
  final FailedReason? failedReason;
  final DateTime? failedAt;

  /// At the customer's door (ADR-030): starts the waiting timer.
  final DateTime? arrivedDropAt;

  /// A door photo may replace the OTP (prepaid, up to Rs 2,000, after arriving).
  final bool photoProofAllowed;
  bool get ready => orderState == 'READY';
}

/// Why a delivery could not be handed over (ADR-026).
enum FailedReason {
  noAnswer('no_answer'),
  wrongAddress('wrong_address'),
  customerRefused('customer_refused'),
  unsafe('unsafe'),
  other('other');

  const FailedReason(this.wire);
  final String wire;
  static FailedReason parse(String s) => values.firstWhere((r) => r.wire == s, orElse: () => other);
}

class Zone {
  const Zone(this.id, this.name, this.nameTe);
  factory Zone.fromJson(Json j) => Zone(j['id'] as String, j['name'] as String, j['nameTe'] as String);
  final String id;
  final String name;
  final String nameTe;
}

class RiderHome {
  const RiderHome({
    required this.name,
    required this.vehicle,
    required this.online,
    required this.zones,
    required this.allZones,
    required this.deliveriesToday,
    required this.earningsTodayPaise,
    required this.onlineMinToday,
    required this.jobs,
    this.rating,
    this.offer,
    this.status = RiderStatus.approved,
    this.statusNote,
    this.cashInHandPaise = 0,
    this.acceptancePct,
    this.cashLimitPaise,
    this.incentives = const [],
  });
  factory RiderHome.fromJson(Json j) {
    final t = j['today'] as Json;
    return RiderHome(
      // An older server sends no status; it had no onboarding, so everyone it knows is approved.
      status: RiderStatus.fromWire(j['status'] as String?),
      statusNote: j['statusNote'] as String?,
      cashInHandPaise: (j['cashInHandPaise'] as int?) ?? 0,
      acceptancePct: j['acceptancePct'] as int?,
      cashLimitPaise: j['cashLimitPaise'] as int?,
      incentives: [for (final i in (j['incentives'] as List?) ?? const []) Incentive.fromJson(i as Json)],
      name: j['name'] as String,
      vehicle: j['vehicle'] as String,
      online: j['online'] as bool,
      zones: (j['zones'] as List).map((z) => Zone.fromJson(z as Json)).toList(),
      allZones: (j['allZones'] as List).map((z) => Zone.fromJson(z as Json)).toList(),
      rating: (j['rating'] as num?)?.toDouble(),
      deliveriesToday: t['deliveries'] as int,
      earningsTodayPaise: t['earningsPaise'] as int,
      onlineMinToday: t['onlineMin'] as int,
      offer: j['offer'] == null ? null : RiderOffer.fromJson(j['offer'] as Json),
      jobs: (j['jobs'] as List).map((x) => Job.fromJson(x as Json)).toList(),
    );
  }
  final String name;
  final String vehicle;
  final bool online;
  final List<Zone> zones;
  final List<Zone> allZones;
  final double? rating;
  final int deliveriesToday;
  final int earningsTodayPaise;
  final int onlineMinToday;
  final RiderOffer? offer;
  final List<Job> jobs;
  /// Onboarding (ADR-029): only approved riders go online.
  final RiderStatus status;
  /// Why ops rejected or paused the rider.
  final String? statusNote;
  /// COD cash collected this payout period; the next payout deducts it.
  final int cashInHandPaise;
  /// Offers accepted ÷ shown, in %; null before the first offer.
  final int? acceptancePct;

  /// At this much cash the rider gets prepaid orders only; null = no limit (ADR-032).
  final int? cashLimitPaise;

  /// Delivery targets with bonuses and progress (ADR-032).
  final List<Incentive> incentives;

  bool get atCashLimit => cashLimitPaise != null && cashInHandPaise >= cashLimitPaise!;
}

/// A delivery target with a bonus and the rider's progress (ADR-032).
class Incentive {
  const Incentive({required this.weekly, required this.deliveries, required this.bonusPaise, required this.done, required this.achieved});
  factory Incentive.fromJson(Json j) => Incentive(
        weekly: j['period'] == 'week',
        deliveries: j['deliveries'] as int,
        bonusPaise: j['bonusPaise'] as int,
        done: j['done'] as int,
        achieved: j['achieved'] as bool,
      );
  final bool weekly;
  final int deliveries;
  final int bonusPaise;
  final int done;
  final bool achieved;
}

/// Rider onboarding status (ADR-029).
enum RiderStatus {
  draft,
  submitted,
  approved,
  rejected,
  suspended;

  static RiderStatus fromWire(String? v) => v == null ? approved : values.firstWhere((s) => s.name == v, orElse: () => draft);
}

/// Vehicles a rider can sign up with. A cycle needs no number plate or driving licence.
enum RiderVehicle {
  bike,
  scooter,
  electric,
  cycle;

  bool get needsLicence => this != cycle;
  static RiderVehicle fromWire(String v) => values.firstWhere((x) => x.name == v, orElse: () => bike);
}

/// One onboarding step: profile, identity (Aadhaar or PAN), driving_licence, bank.
class RiderStep {
  const RiderStep(this.key, this.done);
  final String key;
  final bool done;
}

/// GET /v1/riders/me/onboarding: what the rider has filled in and what is left (ADR-029).
class RiderOnboarding {
  const RiderOnboarding({
    required this.status,
    required this.name,
    required this.vehicle,
    required this.editable,
    required this.steps,
    required this.checks,
    this.statusNote,
    this.vehicleNumber,
    this.submittedAt,
    this.hasSelfie = false,
    this.hasLicencePhoto = false,
  });
  factory RiderOnboarding.fromJson(Json j) => RiderOnboarding(
        hasSelfie: ((j['photos'] as Json?)?['selfie'] as bool?) ?? false,
        hasLicencePhoto: ((j['photos'] as Json?)?['licence'] as bool?) ?? false,
        status: RiderStatus.fromWire(j['status'] as String),
        statusNote: j['statusNote'] as String?,
        name: j['name'] as String,
        vehicle: RiderVehicle.fromWire(j['vehicle'] as String),
        vehicleNumber: j['vehicleNumber'] as String?,
        editable: j['editable'] as bool,
        steps: [for (final s in j['steps'] as List) RiderStep((s as Json)['key'] as String, s['done'] as bool)],
        checks: [for (final c in j['checks'] as List) KycCheck.fromJson(c as Json)],
        submittedAt: _date(j['submittedAt']),
      );
  final RiderStatus status;
  final String? statusNote;
  final String name;
  final RiderVehicle vehicle;
  final String? vehicleNumber;
  final bool editable;
  final List<RiderStep> steps;
  final List<KycCheck> checks;
  final DateTime? submittedAt;

  /// Sign-up photos (ADR-030).
  final bool hasSelfie;
  final bool hasLicencePhoto;

  bool done(String key) => steps.any((s) => s.key == key && s.done);
  bool get complete => steps.every((s) => s.done);
  KycCheck? check(KycKind kind) => checks.where((c) => c.kind == kind).firstOrNull;
}

class Earning {
  const Earning(this.code, this.deliveredAt, this.payPaise, this.payLines);
  factory Earning.fromJson(Json j) =>
      Earning(j['code'] as String, DateTime.parse(j['deliveredAt'] as String), j['payPaise'] as int, (j['payLines'] as List).map((l) => PayLine.fromJson(l as Json)).toList());
  final String code;
  final DateTime deliveredAt;
  final int payPaise;
  final List<PayLine> payLines;
}

class RiderEarnings {
  const RiderEarnings(this.totalPaise, this.onlineMin, this.deliveries);
  factory RiderEarnings.fromJson(Json j) =>
      RiderEarnings(j['totalPaise'] as int, j['onlineMin'] as int, (j['deliveries'] as List).map((d) => Earning.fromJson(d as Json)).toList());
  final int totalPaise;
  final int onlineMin;
  final List<Earning> deliveries;
}

/// One IST day of the 7-day earnings summary.
class EarningDay {
  const EarningDay(this.date, this.deliveries, this.earnedPaise, this.cashPaise);
  factory EarningDay.fromJson(Json j) => EarningDay(DateTime.parse('${j['date']}T00:00:00Z'), j['deliveries'] as int, j['earnedPaise'] as int, j['cashPaise'] as int);
  /// The IST calendar date (midnight UTC of that date; use only the y/m/d).
  final DateTime date;
  final int deliveries;
  final int earnedPaise;
  final int cashPaise;
}

/// GET /v1/riders/me/earnings/week: the last 7 IST days, oldest first.
class RiderWeek {
  const RiderWeek(this.totalPaise, this.deliveries, this.days);
  factory RiderWeek.fromJson(Json j) =>
      RiderWeek(j['totalPaise'] as int, j['deliveries'] as int, [for (final d in j['days'] as List) EarningDay.fromJson(d as Json)]);
  final int totalPaise;
  final int deliveries;
  final List<EarningDay> days;
}

/// Rider app API. Errors: OFFER_EXPIRED (409), WRONG_CODE (422), NOT_READY (409).
class RiderApi {
  RiderApi(this.client, {Dio? uploader}) : _uploader = uploader ?? Dio();
  final SanthaApiClient client;
  /// Plain client for presigned uploads (no auth headers go to storage).
  final Dio _uploader;
  Dio get _dio => client.dio;

  Future<RiderHome> home() async => RiderHome.fromJson(await homeJson());

  /// The raw response, so the rider app can keep a copy of the active deliveries for when the network drops.
  Future<Json> homeJson() => _call(() async => (await _dio.get<Json>('/v1/riders/me')).data!);

  Future<RiderHome> setStatus({required bool online, List<String>? zones}) =>
      _call(() async => RiderHome.fromJson((await _dio.put<Json>('/v1/riders/me/status', data: {'online': online, 'zones': ?zones})).data!));

  Future<void> sendLocation(double lat, double lng) => _call(() => _dio.post<void>('/v1/riders/me/location', data: {'lat': lat, 'lng': lng}));

  Future<RiderEarnings> earnings() => _call(() async => RiderEarnings.fromJson((await _dio.get<Json>('/v1/riders/me/earnings')).data!));

  Future<Job> accept(String offerId) => _job(() => _dio.post<Json>('/v1/offers/$offerId/accept'));

  Future<void> decline(String offerId) => _call(() => _dio.post<void>('/v1/offers/$offerId/decline'));

  Future<Job> job(String id) async => Job.fromJson(await jobJson(id));

  Future<Json> jobJson(String id) => _call(() async => (await _dio.get<Json>('/v1/jobs/$id')).data!);

  Future<Job> arrived(String id) => _job(() => _dio.post<Json>('/v1/jobs/$id/arrived'));

  Future<Job> pickedUp(String id, String pickupCode) => _job(() => _dio.post<Json>('/v1/jobs/$id/picked-up', data: {'pickupCode': pickupCode}));

  Future<Job> delivered(String id, {required String otp, int? codCollectedPaise}) =>
      _job(() => _dio.post<Json>('/v1/jobs/$id/delivered', data: {'otp': otp, 'codCollectedPaise': ?codCollectedPaise}));

  /// Couldn't deliver (ADR-026): the order waits as FAILED_DELIVERY with the rider. 409 INVALID_STATE unless on the way.
  Future<Job> failed(String id, FailedReason reason, {String? note}) =>
      _job(() => _dio.post<Json>('/v1/jobs/$id/failed', data: {'reason': reason.wire, if (note != null && note.trim().isNotEmpty) 'note': note.trim()}));

  /// Back on the way after a failed attempt (the customer called back).
  Future<Job> retry(String id) => _job(() => _dio.post<Json>('/v1/jobs/$id/retry'));

  // ── onboarding (ADR-029) ──

  Future<RiderOnboarding> onboarding() => _onb(() => _dio.get<Json>('/v1/riders/me/onboarding'));

  Future<RiderOnboarding> updateProfile({required String name, required RiderVehicle vehicle, String? vehicleNumber}) => _onb(
        () => _dio.put<Json>('/v1/riders/me/profile', data: {'name': name, 'vehicle': vehicle.name, if (vehicle.needsLicence) 'vehicleNumber': ?vehicleNumber}),
      );

  Future<KycCheck> verifyPan({required String pan, required String name}) =>
      _kyc(() => _dio.put<Json>('/v1/riders/me/kyc/pan', data: {'pan': pan, 'name': name}));

  Future<KycCheck> startAadhaar(String aadhaar) => _kyc(() => _dio.post<Json>('/v1/riders/me/kyc/aadhaar/start', data: {'aadhaar': aadhaar}));

  Future<KycCheck> verifyAadhaar(String otp) => _kyc(() => _dio.post<Json>('/v1/riders/me/kyc/aadhaar/verify', data: {'otp': otp}));

  Future<KycCheck> recordDrivingLicence(String number) =>
      _kyc(() => _dio.put<Json>('/v1/riders/me/kyc/driving-licence', data: {'number': number}));

  Future<KycCheck> verifyBank({required String accountNumber, required String ifsc, required String holderName}) =>
      _kyc(() => _dio.put<Json>('/v1/riders/me/kyc/bank', data: {'accountNumber': accountNumber, 'ifsc': ifsc, 'holderName': holderName}));

  /// Private rider photo (ADR-030): presigned upload, PUT the bytes, complete. Returns the photo id.
  /// [kind]: selfie | licence (while signing up) | delivery (with [fulfilmentId], on the way).
  Future<String> uploadPhoto(Uint8List bytes, {required String kind, required String contentType, String? fulfilmentId}) => _call(() async {
        final t = (await _dio.post<Json>('/v1/riders/me/photos', data: {'kind': kind, 'contentType': contentType, 'fulfilmentId': ?fulfilmentId})).data!;
        final upload = t['upload'] as Json;
        final id = (t['photo'] as Json)['id'] as String;
        await _uploader.put<void>(
          client.resolve(upload['url'] as String),
          data: Stream.fromIterable([bytes]),
          options: Options(headers: {...(upload['headers'] as Map).cast<String, Object>(), Headers.contentLengthHeader: bytes.length}),
        );
        await _dio.post<Json>('/v1/riders/me/photos/$id/complete');
        return id;
      });

  Future<RiderWeek> earningsWeek() => _call(() async => RiderWeek.fromJson((await _dio.get<Json>('/v1/riders/me/earnings/week')).data!));

  /// SOS (ADR-031): alerts Santha ops with the position and the delivery in hand. Returns the alert id; pressing
  /// again returns the open alert.
  Future<String> sos({double? lat, double? lng, bool called112 = false}) => _call(() async {
        final r = await _dio.post<Json>('/v1/riders/me/sos', data: {'lat': ?lat, 'lng': ?lng, 'called112': called112});
        return r.data!['id'] as String;
      });

  /// At the customer's door (ADR-030): the customer is told; the job shows when.
  Future<Job> arrivedDrop(String id) => _job(() => _dio.post<Json>('/v1/jobs/$id/arrived-drop'));

  /// Delivered with a door photo instead of the OTP (prepaid, after arriving; ADR-030).
  Future<Job> deliveredWithPhoto(String id, String photoId) => _job(() => _dio.post<Json>('/v1/jobs/$id/delivered', data: {'photoMediaId': photoId}));

  /// 422 CHECKLIST_INCOMPLETE (details.missing) until every step is done.
  Future<RiderOnboarding> submit() => _onb(() => _dio.post<Json>('/v1/riders/me/submit'));

  Future<RiderOnboarding> _onb(Future<Response<Json>> Function() req) => _call(() async => RiderOnboarding.fromJson((await req()).data!));
  Future<KycCheck> _kyc(Future<Response<Json>> Function() req) => _call(() async => KycCheck.fromJson((await req()).data!));

  /// Payouts (weekly by default) with the earned / cash-held breakdown (M7).
  Future<List<Payout>> payouts() =>
      _call(() async => ((await _dio.get<Json>('/v1/riders/me/payouts')).data!['items'] as List).map((p) => Payout.fromJson(p as Json)).toList());

  Future<Job> _job(Future<Response<Json>> Function() req) => _call(() async => Job.fromJson((await req()).data!));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}

// ───────────── customer tracking ─────────────

class Tracking {
  const Tracking({
    required this.orderId,
    required this.mode,
    required this.state,
    required this.storeName,
    required this.store,
    required this.drop,
    required this.promisedAt,
    required this.fallbackStage,
    required this.canCancelNoCourier,
    this.courier,
    this.deliveryOtp,
    this.courierLocation,
    this.courierLocationAt,
    this.etaAt,
    this.arrivedDropAt,
    this.proofPhotoUrl,
  });
  factory Tracking.fromJson(Json j) {
    final s = j['store'] as Json;
    final loc = j['courierLocation'] as Json?;
    return Tracking(
      orderId: j['orderId'] as String,
      mode: DeliveryMode.values.byName(j['mode'] as String),
      state: _state(j['state'] as String),
      courier: j['courier'] == null ? null : Courier.fromJson(j['courier'] as Json),
      deliveryOtp: j['deliveryOtp'] as String?,
      storeName: s['name'] as String,
      store: Point.fromJson(s),
      drop: Point.fromJson(j['drop'] as Json),
      courierLocation: loc == null ? null : Point.fromJson(loc),
      courierLocationAt: loc == null ? null : DateTime.parse(loc['at'] as String),
      promisedAt: DateTime.parse(j['promisedAt'] as String),
      etaAt: _date(j['etaAt']),
      fallbackStage: _stage(j['fallbackStage'] as String),
      canCancelNoCourier: j['canCancelNoCourier'] as bool,
      arrivedDropAt: _date(j['arrivedDropAt']),
      proofPhotoUrl: j['proofPhotoUrl'] as String?,
    );
  }
  final String orderId;
  final DeliveryMode mode;
  final DeliveryState state;
  final Courier? courier;
  final String? deliveryOtp;
  final String storeName;
  final Point store;
  final Point drop;
  final Point? courierLocation;
  final DateTime? courierLocationAt;
  final DateTime promisedAt;
  final DateTime? etaAt;
  final FallbackStage fallbackStage;
  final bool canCancelNoCourier;

  /// The courier is at the door (ADR-030).
  final DateTime? arrivedDropAt;

  /// Delivered with a door photo: a short-lived link (relative in fake mode; resolve against the API base).
  final String? proofPhotoUrl;

  Tracking withLocation(Point p, DateTime? eta) => Tracking(
        orderId: orderId,
        mode: mode,
        state: state,
        courier: courier,
        deliveryOtp: deliveryOtp,
        storeName: storeName,
        store: store,
        drop: drop,
        courierLocation: p,
        courierLocationAt: DateTime.now(),
        promisedAt: promisedAt,
        etaAt: eta ?? etaAt,
        fallbackStage: fallbackStage,
        canCancelNoCourier: canCancelNoCourier,
        arrivedDropAt: arrivedDropAt,
        proofPhotoUrl: proofPhotoUrl,
      );
}

// ───────────── merchant ─────────────

class MerchantDelivery {
  const MerchantDelivery({
    required this.orderId,
    required this.mode,
    required this.state,
    required this.pickupCode,
    required this.fallbackStage,
    required this.selfBonusPaise,
    required this.promisedAt,
    this.courier,
    this.staffLink,
    this.etaAt,
  });
  factory MerchantDelivery.fromJson(Json j) => MerchantDelivery(
        orderId: j['orderId'] as String,
        mode: DeliveryMode.values.byName(j['mode'] as String),
        state: _state(j['state'] as String),
        pickupCode: j['pickupCode'] as String,
        courier: j['courier'] == null ? null : Courier.fromJson(j['courier'] as Json),
        staffLink: j['staffLink'] as String?,
        fallbackStage: _stage(j['fallbackStage'] as String),
        selfBonusPaise: j['selfBonusPaise'] as int,
        promisedAt: DateTime.parse(j['promisedAt'] as String),
        etaAt: _date(j['etaAt']),
      );
  final String orderId;
  final DeliveryMode mode;
  final DeliveryState state;
  final String pickupCode;
  final Courier? courier;
  final String? staffLink;
  final FallbackStage fallbackStage;
  final int selfBonusPaise;
  final DateTime promisedAt;
  final DateTime? etaAt;
}

class StatementLine {
  const StatementLine({
    required this.code,
    required this.mode,
    required this.itemsPaise,
    required this.commissionPercent,
    required this.commissionPaise,
    required this.deliveryFeeCreditPaise,
    required this.selfBonusPaise,
    required this.netPaise,
  });
  factory StatementLine.fromJson(Json j) => StatementLine(
        code: j['code'] as String,
        mode: DeliveryMode.values.byName(j['mode'] as String),
        itemsPaise: j['itemsPaise'] as int,
        commissionPercent: (j['commissionPercent'] as num).toDouble(),
        commissionPaise: j['commissionPaise'] as int,
        deliveryFeeCreditPaise: j['deliveryFeeCreditPaise'] as int,
        selfBonusPaise: j['selfBonusPaise'] as int,
        netPaise: j['netPaise'] as int,
      );
  final String code;
  final DeliveryMode mode;
  final int itemsPaise;
  final double commissionPercent;
  final int commissionPaise;
  final int deliveryFeeCreditPaise;
  final int selfBonusPaise;
  final int netPaise;
}

class StatementPreview {
  const StatementPreview(this.date, this.lines, this.orders, this.netPaise, this.commissionPaise, this.deliveryFeeCreditPaise);
  factory StatementPreview.fromJson(Json j) {
    final t = j['totals'] as Json;
    return StatementPreview(
      j['date'] as String,
      (j['lines'] as List).map((l) => StatementLine.fromJson(l as Json)).toList(),
      t['orders'] as int,
      t['netPaise'] as int,
      t['commissionPaise'] as int,
      t['deliveryFeeCreditPaise'] as int,
    );
  }
  final String date;
  final List<StatementLine> lines;
  final int orders;
  final int netPaise;
  final int commissionPaise;
  final int deliveryFeeCreditPaise;
}
