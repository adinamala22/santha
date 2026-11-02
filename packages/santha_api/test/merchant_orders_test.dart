import 'dart:convert';
import 'dart:io';

import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// Contract: the M5 models parse real responses captured from `pnpm dev:fake`.
void main() {
  test('new orders: waiting for a decision, address hidden until accepted', () {
    final list = MerchantOrderList.fromJson(fixture('merchant_orders_new'));
    expect(list.items, isNotEmpty);
    final o = list.items.first;
    expect(o.state, OrderState.placed);
    expect(o.acceptBy, isNotNull);
    expect(o.addressLine, isNull);
    expect(o.distanceM, greaterThan(0));
    expect(list.counts[OrderBucket.newOrders], list.items.length);
  });

  test('preparing: substituted and removed lines carry refunds; address revealed', () {
    final list = MerchantOrderList.fromJson(fixture('merchant_orders_preparing'));
    final o = list.items.single;
    expect(o.state, OrderState.preparing);
    expect(o.addressLine, isNotNull);
    expect(o.packBy, isNotNull);
    expect(o.lines.map((l) => l.status), [LineStatus.substituted, LineStatus.removed]);
    expect(o.lines.first.substituteName, isNotNull);
    expect(o.refundedPaise, o.lines.fold<int>(0, (s, l) => s + l.refundPaise));
    expect(o.paymentMethod, PaymentMethodChoice.cod);
    expect(o.codDuePaise, o.totalPaise - o.refundedPaise);
    expect(list.summary.orders, greaterThanOrEqualTo(0));
  });

  test('consumer view of the same order: line changes, refund, no cancel once accepted', () {
    final o = Order.fromJson(fixture('order_substituted'));
    expect(o.state, OrderState.preparing);
    expect(o.canCancel, isFalse);
    expect(o.refundedPaise, greaterThan(0));
    expect(o.lines.map((l) => l.status), ['substituted', 'removed']);
    expect(Order.fromJson(fixture('order_placed')).canCancel, isTrue);
  });
}
