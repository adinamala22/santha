import 'dart:convert';
import 'dart:io';

import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// Contract: the M6 models parse real responses captured from `pnpm dev:fake`.
void main() {
  test('rider home with an offer: pay adds up, drop is an area only', () {
    final h = RiderHome.fromJson(fixture('rider_home_offer'));
    expect(h.online, isTrue);
    expect(h.zones, isNotEmpty);
    expect(h.allZones.length, greaterThanOrEqualTo(h.zones.length));
    final o = h.offer!;
    expect(o.storeName, 'Ramesh Stores');
    expect(o.payPaise, o.payLines.fold<int>(0, (s, l) => s + l.amountPaise));
    expect(o.payLines.map((l) => l.code), containsAll(['base', 'distance']));
    expect(o.dropArea, isNotEmpty);
    expect(o.expiresAt.isAfter(DateTime.utc(2026)), isTrue);
  });

  test('assigned job: exact drop address, masked call number, pickup code required', () {
    final j = Job.fromJson(fixture('job_assigned'));
    expect(j.state, DeliveryState.assigned);
    expect(j.mode, DeliveryMode.rider);
    expect(j.pickupCodeRequired, isTrue);
    expect(j.dropLine, isNotEmpty);
    expect(j.callNumber, startsWith('+9180471'));
    expect(j.codDuePaise, greaterThan(0));
    expect(j.instructions, 'Call before coming');
  });

  test('staff job: no pickup code, no pay', () {
    final j = Job.fromJson(fixture('staff_job_picked_up'));
    expect(j.mode, DeliveryMode.self);
    expect(j.state, DeliveryState.pickedUp);
    expect(j.pickupCodeRequired, isFalse);
    expect(j.payPaise, 0);
  });

  test('tracking: courier, OTP and live location while on the way', () {
    final t = Tracking.fromJson(fixture('tracking_picked_up'));
    expect(t.state, DeliveryState.pickedUp);
    expect(t.courier!.kind, CourierKind.rider);
    expect(t.deliveryOtp, matches(RegExp(r'^\d{4}$')));
    expect(t.courierLocation, isNotNull);
    expect(t.etaAt, isNotNull);
    expect(t.fallbackStage, FallbackStage.none);
    expect(t.canCancelNoCourier, isFalse);
  });

  test('merchant deliveries and statement preview', () {
    final d = (fixture('merchant_deliveries')['items'] as List).map((x) => MerchantDelivery.fromJson(x as Map<String, dynamic>)).toList();
    expect(d.single.pickupCode, matches(RegExp(r'^\d{4}$')));
    expect(d.single.courier!.kind, CourierKind.rider);
    final s = StatementPreview.fromJson(fixture('statement_preview'));
    expect(s.orders, s.lines.length);
    final self = s.lines.firstWhere((l) => l.mode == DeliveryMode.self);
    final rider = s.lines.firstWhere((l) => l.mode == DeliveryMode.rider);
    expect(self.commissionPercent, lessThan(rider.commissionPercent));
    expect(self.deliveryFeeCreditPaise, greaterThanOrEqualTo(0));
    expect(rider.deliveryFeeCreditPaise, 0);
    expect(s.netPaise, s.lines.fold<int>(0, (a, l) => a + l.netPaise));
    final e = RiderEarnings.fromJson(fixture('rider_earnings'));
    expect(e.totalPaise, e.deliveries.fold<int>(0, (a, x) => a + x.payPaise));
  });
}
