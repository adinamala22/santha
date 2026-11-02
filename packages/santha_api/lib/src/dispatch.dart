// Dispatch & tracking models and API (M6), mirroring dispatch.dto.ts.
import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'models.dart';

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
  bool get ready => orderState == 'READY';
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
  });
  factory RiderHome.fromJson(Json j) {
    final t = j['today'] as Json;
    return RiderHome(
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

/// Rider app API. Errors: OFFER_EXPIRED (409), WRONG_CODE (422), NOT_READY (409).
class RiderApi {
  RiderApi(this.client);
  final SanthaApiClient client;
  Dio get _dio => client.dio;

  Future<RiderHome> home() => _call(() async => RiderHome.fromJson((await _dio.get<Json>('/v1/riders/me')).data!));

  Future<RiderHome> setStatus({required bool online, List<String>? zones}) =>
      _call(() async => RiderHome.fromJson((await _dio.put<Json>('/v1/riders/me/status', data: {'online': online, 'zones': ?zones})).data!));

  Future<void> sendLocation(double lat, double lng) => _call(() => _dio.post<void>('/v1/riders/me/location', data: {'lat': lat, 'lng': lng}));

  Future<RiderEarnings> earnings() => _call(() async => RiderEarnings.fromJson((await _dio.get<Json>('/v1/riders/me/earnings')).data!));

  Future<Job> accept(String offerId) => _job(() => _dio.post<Json>('/v1/offers/$offerId/accept'));

  Future<void> decline(String offerId) => _call(() => _dio.post<void>('/v1/offers/$offerId/decline'));

  Future<Job> job(String id) => _job(() => _dio.get<Json>('/v1/jobs/$id'));

  Future<Job> arrived(String id) => _job(() => _dio.post<Json>('/v1/jobs/$id/arrived'));

  Future<Job> pickedUp(String id, String pickupCode) => _job(() => _dio.post<Json>('/v1/jobs/$id/picked-up', data: {'pickupCode': pickupCode}));

  Future<Job> delivered(String id, {required String otp, int? codCollectedPaise}) =>
      _job(() => _dio.post<Json>('/v1/jobs/$id/delivered', data: {'otp': otp, 'codCollectedPaise': ?codCollectedPaise}));

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
