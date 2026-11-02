// Merchant order models and API (M5), mirroring MerchantOrderDto / MerchantOrderListDto.
import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'checkout_models.dart' show OrderState, PaymentMethodChoice;
import 'merchant_models.dart';
import 'models.dart';

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);

/// Merchant app tabs.
enum OrderBucket { newOrders, preparing, ready, out, done }

extension OrderBucketWire on OrderBucket {
  String get wire => this == OrderBucket.newOrders ? 'new' : name;
}

enum LineStatus { ok, removed, substituted }

class MerchantOrderLine {
  const MerchantOrderLine({
    required this.itemId,
    required this.variantId,
    required this.name,
    required this.variantLabel,
    required this.quantity,
    required this.unitPricePaise,
    required this.linePaise,
    required this.substitution,
    required this.status,
    required this.refundPaise,
    this.substituteName,
    this.substituteVariantLabel,
  });
  factory MerchantOrderLine.fromJson(Json j) => MerchantOrderLine(
        itemId: j['itemId'] as String,
        variantId: j['variantId'] as String,
        name: j['name'] as String,
        variantLabel: j['variantLabel'] as String,
        quantity: j['quantity'] as int,
        unitPricePaise: j['unitPricePaise'] as int,
        linePaise: j['linePaise'] as int,
        substitution: j['substitution'] as String,
        status: LineStatus.values.byName(j['status'] as String),
        refundPaise: j['refundPaise'] as int,
        substituteName: j['substituteName'] as String?,
        substituteVariantLabel: j['substituteVariantLabel'] as String?,
      );
  final String itemId;
  final String variantId;
  final String name;
  final String variantLabel;
  final int quantity;
  final int unitPricePaise;
  final int linePaise;
  /// The customer's choice if unavailable: call_me | similar | remove.
  final String substitution;
  final LineStatus status;
  final int refundPaise;
  final String? substituteName;
  final String? substituteVariantLabel;
}

class MerchantOrder {
  const MerchantOrder({
    required this.id,
    required this.code,
    required this.state,
    required this.paymentMethod,
    required this.itemCount,
    required this.itemsPaise,
    required this.totalPaise,
    required this.refundedPaise,
    required this.codDuePaise,
    required this.distanceM,
    required this.lines,
    this.fulfilmentMode,
    this.slotStartsAt,
    this.addressLine,
    this.landmark,
    this.instructions,
    this.placedAt,
    this.acceptBy,
    this.expiresAt,
    this.acceptedAt,
    this.packBy,
    this.readyAt,
    this.outcomeReason,
  });

  factory MerchantOrder.fromJson(Json j) {
    final address = j['address'] as Json?;
    return MerchantOrder(
      id: j['id'] as String,
      code: j['code'] as String,
      state: OrderState.parse(j['state'] as String),
      paymentMethod: j['paymentMethod'] == 'cod' ? PaymentMethodChoice.cod : PaymentMethodChoice.online,
      fulfilmentMode: j['fulfilmentMode'] == null ? null : FulfilmentMode.values.byName(j['fulfilmentMode'] as String),
      itemCount: j['itemCount'] as int,
      itemsPaise: j['itemsPaise'] as int,
      totalPaise: j['totalPaise'] as int,
      refundedPaise: j['refundedPaise'] as int,
      codDuePaise: j['codDuePaise'] as int,
      slotStartsAt: _date((j['when'] as Json)['slotStartsAt']),
      distanceM: j['distanceM'] as int,
      addressLine: address?['line'] as String?,
      landmark: address?['landmark'] as String?,
      instructions: j['instructions'] as String?,
      lines: ((j['lines'] as List?) ?? const []).map((l) => MerchantOrderLine.fromJson(l as Json)).toList(),
      placedAt: _date(j['placedAt']),
      acceptBy: _date(j['acceptBy']),
      expiresAt: _date(j['expiresAt']),
      acceptedAt: _date(j['acceptedAt']),
      packBy: _date(j['packBy']),
      readyAt: _date(j['readyAt']),
      outcomeReason: j['outcomeReason'] as String?,
    );
  }

  final String id;
  final String code;
  final OrderState state;
  final PaymentMethodChoice paymentMethod;
  final FulfilmentMode? fulfilmentMode;
  final int itemCount;
  final int itemsPaise;
  final int totalPaise;
  final int refundedPaise;
  final int codDuePaise;
  final DateTime? slotStartsAt;
  final int distanceM;
  /// Shown only after you accept.
  final String? addressLine;
  final String? landmark;
  final String? instructions;
  final List<MerchantOrderLine> lines;
  final DateTime? placedAt;
  final DateTime? acceptBy;
  final DateTime? expiresAt;
  final DateTime? acceptedAt;
  final DateTime? packBy;
  final DateTime? readyAt;
  final String? outcomeReason;

  /// How many lines the customer allows a substitute for.
  int get substitutesAllowed => lines.where((l) => l.substitution == 'similar').length;
}

class MerchantDaySummary {
  const MerchantDaySummary({required this.orders, required this.itemsPaise, this.acceptanceRate, this.avgPrepMin});
  factory MerchantDaySummary.fromJson(Json j) =>
      MerchantDaySummary(orders: j['orders'] as int, itemsPaise: j['itemsPaise'] as int, acceptanceRate: (j['acceptanceRate'] as num?)?.toDouble(), avgPrepMin: j['avgPrepMin'] as int?);
  final int orders;
  final int itemsPaise;
  final double? acceptanceRate;
  final int? avgPrepMin;
}

class MerchantOrderList {
  const MerchantOrderList({required this.items, required this.counts, required this.summary});
  factory MerchantOrderList.fromJson(Json j) {
    final c = j['counts'] as Json;
    return MerchantOrderList(
      items: ((j['items'] as List?) ?? const []).map((o) => MerchantOrder.fromJson(o as Json)).toList(),
      counts: {for (final b in OrderBucket.values) b: c[b.wire] as int? ?? 0},
      summary: MerchantDaySummary.fromJson(j['summary'] as Json),
    );
  }
  final List<MerchantOrder> items;
  final Map<OrderBucket, int> counts;
  final MerchantDaySummary summary;
}

/// Store orders for the merchant app (M5). Errors are [ApiException]s (INVALID_STATE when the order
/// moved on — refresh and show the new state).
class MerchantOrdersApi {
  MerchantOrdersApi(this.client);
  final SanthaApiClient client;
  Dio get _dio => client.dio;

  Future<MerchantOrderList> list(OrderBucket bucket) =>
      _call(() async => MerchantOrderList.fromJson((await _dio.get<Json>('/v1/merchants/me/orders', queryParameters: {'bucket': bucket.wire})).data!));

  Future<MerchantOrder> get(String id) => _order(() => _dio.get<Json>('/v1/merchants/me/orders/$id'));

  Future<MerchantOrder> accept(String id, {FulfilmentMode? mode}) => _order(() => _dio.post<Json>('/v1/orders/$id/accept', data: {'fulfilmentMode': ?mode?.name}));

  Future<MerchantOrder> reject(String id, String reason) => _order(() => _dio.post<Json>('/v1/orders/$id/reject', data: {'reason': reason}));

  Future<MerchantOrder> ready(String id) => _order(() => _dio.post<Json>('/v1/orders/$id/ready'));

  Future<MerchantOrder> removeItem(String id, String variantId) =>
      _order(() => _dio.post<Json>('/v1/orders/$id/items/$variantId/unavailable', data: {'action': 'remove'}));

  Future<MerchantOrder> substituteItem(String id, String variantId, {required String withItemId, required String withVariantId}) =>
      _order(() => _dio.post<Json>('/v1/orders/$id/items/$variantId/unavailable', data: {'action': 'substitute', 'itemId': withItemId, 'variantId': withVariantId}));

  /// Open (true) or pause the store.
  Future<MerchantView> setAvailability(bool open) =>
      _call(() async => MerchantView.fromJson((await _dio.put<Json>('/v1/merchants/me/availability', data: {'open': open})).data!));

  Future<void> registerPushToken(String token, String platform) => _call(() => _dio.put<void>('/v1/me/push-token', data: {'token': token, 'platform': platform}));

  Future<MerchantOrder> _order(Future<Response<Json>> Function() req) => _call(() async => MerchantOrder.fromJson((await req()).data!));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
