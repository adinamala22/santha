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

  test('ratings: store page breakdown with replies; my rating, or none yet; merchant summary', () {
    final page = StoreReviews.fromJson(fixture('store_reviews_public'));
    expect(page.summary.count, 3);
    expect(page.summary.avg, 4.0);
    expect(page.summary.distribution, [0, 0, 1, 1, 1]);
    expect(page.summary.share(5), closeTo(1 / 3, 1e-9));
    expect(page.items, hasLength(2)); // the stars-only rating is not listed
    expect(page.items.last.reply, 'Thank you! See you again.');
    expect(page.items.last.replyAt, isNotNull);
    expect(page.summary.toJson()['distribution'], [0, 0, 1, 1, 1]);

    final mine = OrderRating.fromJson(fixture('order_rating')['rating'] as Map<String, dynamic>);
    expect(mine.storeStars, 4);
    expect(mine.riderStars, isNull);
    expect(mine.comment, 'Good, packing could be better');
    expect(fixture('order_rating_none')['rating'], isNull);

    final merchant = fixture('merchant_reviews');
    final summary = RatingSummary.fromJson(merchant['summary'] as Map<String, dynamic>);
    expect(summary.count, page.summary.count);
    expect(items('merchant_reviews').map(StoreReview.fromJson).first.storeStars, isPositive);
    expect(RatingSummary.empty.share(1), 0);
  });
}
