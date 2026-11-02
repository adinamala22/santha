import 'dart:convert';
import 'dart:io';

import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;
List<Map<String, dynamic>> items(String name) => (fixture(name)['items'] as List).cast<Map<String, dynamic>>();

/// Contract: the M8 models parse real responses captured from `pnpm dev:fake`.
void main() {
  test('consents: terms and privacy given for the notice in force; marketing off', () {
    final c = {for (final x in items('consents').map(Consent.fromJson)) x.purpose: x};
    expect(c['terms']!.granted && c['terms']!.current, isTrue);
    expect(c['privacy']!.granted, isTrue);
    expect(c['marketing']!.granted, isFalse);
  });

  test('a grievance opens with a 30-day resolve-by date', () {
    final g = Grievance.fromJson(fixture('grievance_open'));
    expect(g.status, 'open');
    expect(g.category, 'refund');
    expect(g.resolveDueAt.difference(g.createdAt).inDays, 30);
  });

  test('an access request is completed at once and its export lists what we hold', () {
    final r = DataRequest.fromJson(fixture('data_request_access'));
    expect(r.type, 'access');
    expect(r.status, 'completed');
    expect(r.exportReady, isTrue);
    final ex = fixture('data_export');
    expect(ex.keys, containsAll(['account', 'addresses', 'orders', 'consents', 'grievances']));
    expect(ex['orders'] as List, isNotEmpty);
  });

  test('store reviews and a reply', () {
    final r = StoreReview.fromJson(items('store_reviews').first);
    expect(r.storeStars, 5);
    expect(r.reply, isNull);
    final replied = StoreReview.fromJson(fixture('store_review_replied'));
    expect(replied.orderId, r.orderId);
    expect(replied.reply, 'Thank you! See you again.');
  });
}
