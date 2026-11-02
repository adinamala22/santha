import 'dart:convert';

import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:merchant/features/orders/data/orders_controller.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

/// Fixed "now" for countdowns in widget tests (11:30 IST).
final testNow = DateTime.utc(2026, 11, 2, 6, 0);

Map<String, dynamic> orderLine(String variantId, String name, int unitPaise, {int qty = 1, String substitution = 'similar', String label = '1 kg'}) => {
      'itemId': 'item-$variantId', 'variantId': variantId, 'name': name, 'variantLabel': label, 'quantity': qty, 'unitPricePaise': unitPaise,
      'linePaise': unitPaise * qty, 'substitution': substitution, 'status': 'ok', 'refundPaise': 0, 'substituteName': null, 'substituteVariantLabel': null,
    };

Map<String, dynamic> merchantOrder(String id, String code, {String state = 'PLACED', String payment = 'online', List<Map<String, dynamic>>? lines, int acceptInSec = 17}) {
  final ls = lines ?? [orderLine('v-atta', 'Chakki Atta', 6200, qty: 2), orderLine('v-dal', 'Toor Dal', 15000, substitution: 'remove')];
  final items = ls.fold<int>(0, (s, l) => s + (l['linePaise'] as int));
  final placed = state == 'PLACED';
  return {
    'id': id, 'code': code, 'state': state, 'paymentMethod': payment, 'fulfilmentMode': placed ? null : 'rider',
    'itemCount': ls.fold<int>(0, (s, l) => s + (l['quantity'] as int)), 'itemsPaise': items, 'totalPaise': items + 3000, 'refundedPaise': 0,
    'codDuePaise': payment == 'cod' ? items + 3000 : 0, 'when': {'mode': 'asap', 'slotStartsAt': null}, 'distanceM': 1800,
    'address': placed ? null : {'line': '12-3 Pogathota', 'landmark': 'Near Gandhi statue'}, 'instructions': null, 'lines': ls,
    'placedAt': testNow.subtract(const Duration(seconds: 30)).toIso8601String(),
    'acceptBy': placed ? testNow.add(Duration(seconds: acceptInSec)).toIso8601String() : null,
    'expiresAt': null,
    'acceptedAt': placed ? null : testNow.subtract(const Duration(minutes: 5)).toIso8601String(),
    'packBy': placed ? null : testNow.add(const Duration(minutes: 10)).toIso8601String(),
    'readyAt': null, 'outcomeReason': null,
  };
}

/// In-memory merchant orders backend with the lifecycle rules the screens rely on.
class FakeMerchantOrdersApi extends MerchantOrdersApi {
  FakeMerchantOrdersApi(super.client, this.orders, this.merchantView);
  final List<Map<String, dynamic>> orders;
  final Map<String, dynamic> merchantView;
  final calls = <String>[];

  static const _buckets = {
    OrderBucket.newOrders: ['PLACED'],
    OrderBucket.preparing: ['ACCEPTED', 'PREPARING'],
    OrderBucket.ready: ['READY'],
    OrderBucket.out: ['PICKED_UP', 'OUT_FOR_DELIVERY'],
    OrderBucket.done: ['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED_DELIVERY'],
  };

  MerchantOrder _parse(Map<String, dynamic> j) => MerchantOrder.fromJson(jsonDecode(jsonEncode(j)) as Map<String, dynamic>);
  Map<String, dynamic> _find(String id) => orders.firstWhere((o) => o['id'] == id);
  void _expect(Map<String, dynamic> o, List<String> states) {
    if (!states.contains(o['state'])) throw const ApiException(code: 'INVALID_STATE', status: 409);
  }

  @override
  Future<MerchantOrderList> list(OrderBucket bucket) async {
    final rows = orders.where((o) => _buckets[bucket]!.contains(o['state'])).toList();
    return MerchantOrderList.fromJson(jsonDecode(jsonEncode({
      'items': rows,
      'counts': {for (final e in _buckets.entries) e.key.wire: orders.where((o) => e.value.contains(o['state'])).length},
      'summary': {'orders': orders.where((o) => o['state'] != 'PLACED').length, 'itemsPaise': 48000, 'acceptanceRate': 0.94, 'avgPrepMin': 12},
    })) as Map<String, dynamic>);
  }

  @override
  Future<MerchantOrder> get(String id) async => _parse(_find(id));

  @override
  Future<MerchantOrder> accept(String id, {FulfilmentMode? mode}) async {
    calls.add('accept $id');
    final o = _find(id);
    _expect(o, ['PLACED']);
    o.addAll({'state': 'PREPARING', 'acceptedAt': testNow.toIso8601String(), 'packBy': testNow.add(const Duration(minutes: 15)).toIso8601String(),
      'address': {'line': '12-3 Pogathota', 'landmark': null}, 'acceptBy': null, 'fulfilmentMode': 'rider'});
    return _parse(o);
  }

  @override
  Future<MerchantOrder> reject(String id, String reason) async {
    calls.add('reject $id $reason');
    final o = _find(id);
    _expect(o, ['PLACED']);
    o.addAll({'state': 'REJECTED', 'outcomeReason': reason});
    return _parse(o);
  }

  @override
  Future<MerchantOrder> ready(String id) async {
    calls.add('ready $id');
    final o = _find(id);
    _expect(o, ['PREPARING']);
    o['state'] = 'READY';
    return _parse(o);
  }

  Map<String, dynamic> _line(Map<String, dynamic> o, String variantId) => (o['lines'] as List).cast<Map<String, dynamic>>().firstWhere((l) => l['variantId'] == variantId);

  @override
  Future<MerchantOrder> removeItem(String id, String variantId) async {
    calls.add('remove $id $variantId');
    final o = _find(id);
    _expect(o, ['ACCEPTED', 'PREPARING']);
    final l = _line(o, variantId);
    l.addAll({'status': 'removed', 'refundPaise': l['linePaise']});
    o['refundedPaise'] = (o['refundedPaise'] as int) + (l['linePaise'] as int);
    return _parse(o);
  }

  @override
  Future<MerchantOrder> substituteItem(String id, String variantId, {required String withItemId, required String withVariantId}) async {
    calls.add('substitute $id $variantId $withItemId/$withVariantId');
    final o = _find(id);
    final l = _line(o, variantId);
    l.addAll({'status': 'substituted', 'substituteName': 'Substitute', 'substituteVariantLabel': '1 kg', 'refundPaise': 1200});
    o['refundedPaise'] = (o['refundedPaise'] as int) + 1200;
    return _parse(o);
  }

  @override
  Future<MerchantView> setAvailability(bool open) async {
    calls.add('open $open');
    final m = merchantView['merchant'] as Map<String, dynamic>;
    m['acceptingOrders'] = open;
    m['pausedReason'] = open ? null : 'owner';
    return MerchantView.fromJson(jsonDecode(jsonEncode(merchantView)) as Map<String, dynamic>);
  }
}

class AlertCounter {
  int rings = 0;
}

/// Overrides that keep the orders board deterministic: fake API, no polling, fixed clock,
/// a fake socket and counted rings.
List<Override> orderOverrides({
  required List<Map<String, dynamic>> orders,
  required Map<String, dynamic> view,
  required void Function(FakeMerchantOrdersApi) onApi,
  FakeRealtime? realtime,
  AlertCounter? alerts,
}) =>
    [
      merchantOrdersApiProvider.overrideWith((ref) {
        final api = FakeMerchantOrdersApi(ref.watch(apiClientProvider), orders, view);
        onApi(api);
        return api;
      }),
      ordersPollEveryProvider.overrideWithValue(null),
      nowTickerProvider.overrideWith((ref) => Stream.value(testNow)),
      realtimeProvider.overrideWithValue(realtime ?? FakeRealtime()),
      orderAlertProvider.overrideWithValue(() => alerts?.rings++),
    ];
