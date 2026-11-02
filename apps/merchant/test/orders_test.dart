import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:merchant/features/catalogue/data/catalogue_controller.dart';
import 'package:merchant/features/orders/data/orders_controller.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import 'catalogue_test.dart' show FakeCatalogueApi;
import 'onboarding_test.dart' show FakeMerchantApi, pumpSignedIn;
import 'package:merchant/features/orders/presentation/reviews_view.dart';

import 'support/fake_orders.dart';

Map<String, dynamic> _liveView({bool open = true, String? pausedReason}) {
  final v = FakeMerchantApi.build(type: 'retail', status: 'live', microMarket: {'id': 'mm1', 'slug': 'dargamitta', 'name': 'Dargamitta', 'nameTe': 'దర్గామిట్ట'});
  (v['merchant'] as Map<String, dynamic>).addAll({'name': 'Sri Venkateswara Kirana', 'acceptingOrders': open, 'pausedReason': pausedReason});
  return v;
}

Map<String, dynamic> _variant(String id, String label, int price, {String stock = 'in'}) =>
    {'id': id, 'label': label, 'unit': 'kg', 'unitQty': 1, 'pricePaise': price, 'mrpPaise': null, 'stock': stock};

Map<String, dynamic> _item(String id, String name, List<Map<String, dynamic>> variants) => {
      'id': id, 'merchantId': 'm1', 'masterProductId': null, 'name': name, 'nameTe': null, 'description': null, 'brand': null,
      'categorySlug': 'staples', 'foodMark': 'veg', 'allergens': <String>[], 'madeToOrder': false, 'leadTimeMin': null, 'maxPerOrder': null,
      'availableDays': <String>[], 'dailyCapacity': null, 'specialOn': null, 'status': 'active', 'reviewReason': null, 'source': 'merchant',
      'images': <Object>[], 'imageUrl': null, 'stock': 'in', 'stale': false, 'confirmedAt': '2026-11-01T00:00:00.000Z', 'variants': variants,
      'createdAt': '2026-11-01T00:00:00.000Z', 'updatedAt': '2026-11-01T00:00:00.000Z',
    };

void main() {
  testWidgets('a new order rings, shows the countdown and is accepted into Preparing', (tester) async {
    late FakeMerchantOrdersApi api;
    final alerts = AlertCounter();
    final (container, _) = await pumpSignedIn(tester, view: _liveView(), orders: [merchantOrder('o1', 'SN-4821')], onOrdersApi: (a) => api = a, alerts: alerts);

    expect(find.text('Sri Venkateswara Kirana'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
    expect(find.text('New order · #SN-4821'), findsOneWidget);
    expect(find.text('3 items · ₹274 · 1.8 km'), findsOneWidget);
    expect(find.text('Substitutes: allowed for 1 item'), findsOneWidget);
    expect(find.text('Accept 0:17'), findsOneWidget);
    expect(alerts.rings, 1);
    expect(find.text('12-3 Pogathota'), findsNothing); // address only after accepting

    await tester.tap(find.byKey(const ValueKey('accept-o1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('mode-rider')));
    await tester.tap(find.byKey(const ValueKey('confirm-accept')));
    await tester.pumpAndSettle();
    expect(api.calls, ['accept o1 rider']);
    expect(find.byKey(const ValueKey('new-o1')), findsNothing);
    expect(find.byKey(const ValueKey('order-o1')), findsOneWidget);
    expect(find.text('Preparing (1)'), findsOneWidget);
    expect(find.textContaining('12-3 Pogathota'), findsOneWidget);
    expect(alerts.rings, 1); // no ring for an order already seen
    final events = (container.read(analyticsProvider) as DebugAnalytics).events.map((e) => e.$1);
    expect(events, contains('order_accepted'));

    await tester.tap(find.byKey(const ValueKey('ready-o1')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'ready o1');
    expect(find.text('Ready (1)'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('tab-ready')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('order-o1')), findsOneWidget);
  });

  testWidgets('past the countdown the order can still be accepted until it expires', (tester) async {
    await pumpSignedIn(tester, view: _liveView(), orders: [merchantOrder('late', 'SN-5', acceptInSec: -10), merchantOrder('gone', 'SN-6', acceptInSec: -110, expireInSec: -1)]);
    expect(find.descendant(of: find.byKey(const ValueKey('accept-late')), matching: find.text('Accept')), findsOneWidget);
    expect(tester.widget<SanthaButton>(find.byKey(const ValueKey('accept-late'))).onPressed, isNotNull);
    expect(find.descendant(of: find.byKey(const ValueKey('accept-gone')), matching: find.text('Time is up')), findsOneWidget);
    expect(tester.widget<SanthaButton>(find.byKey(const ValueKey('accept-gone'))).onPressed, isNull);
  });

  testWidgets('reject asks for a reason', (tester) async {
    late FakeMerchantOrdersApi api;
    await pumpSignedIn(tester, view: _liveView(), orders: [merchantOrder('o1', 'SN-1')], onOrdersApi: (a) => api = a);
    await tester.tap(find.byKey(const ValueKey('reject-o1')));
    await tester.pumpAndSettle();
    expect(find.text('Why can you not take this order?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('reason-too_busy')));
    await tester.pumpAndSettle();
    expect(api.calls, ['reject o1 too_busy']);
    expect(find.byKey(const ValueKey('new-o1')), findsNothing);
    expect(find.text('Done (1)'), findsOneWidget);
  });

  testWidgets('an order that expired meanwhile refreshes with a message', (tester) async {
    late FakeMerchantOrdersApi api;
    final orders = [merchantOrder('o1', 'SN-2')];
    await pumpSignedIn(tester, view: _liveView(), orders: orders, onOrdersApi: (a) => api = a);
    orders.first['state'] = 'EXPIRED'; // the accept window ran out on the server
    await tester.tap(find.byKey(const ValueKey('accept-o1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('mode-rider')));
    await tester.tap(find.byKey(const ValueKey('confirm-accept')));
    await tester.pumpAndSettle();
    expect(api.calls, ['accept o1 rider']);
    expect(find.text('This order changed. We refreshed the list.'), findsOneWidget);
    expect(find.byKey(const ValueKey('new-o1')), findsNothing);
  });

  testWidgets('item unavailable: remove refunds; substitute offers only in-stock items at the same price or less', (tester) async {
    late FakeMerchantOrdersApi api;
    await pumpSignedIn(
      tester,
      view: _liveView(),
      orders: [merchantOrder('o1', 'SN-3', state: 'PREPARING')],
      onOrdersApi: (a) => api = a,
      overrides: [
        catalogueApiProvider.overrideWith((ref) => FakeCatalogueApi(ref.watch(apiClientProvider), [
              _item('i-atta2', 'Aashirvaad Atta', [_variant('v-a2', '1 kg', 5000), _variant('v-a5', '5 kg', 24000)]),
              _item('i-ragi', 'Ragi Flour', [_variant('v-ragi', '1 kg', 4000, stock: 'out')]),
            ])),
      ],
    );
    expect(find.text('Pack by 11:40 AM'), findsOneWidget);

    // Toor Dal: the customer said "remove it", so no substitute option.
    await tester.tap(find.byKey(const ValueKey('unavailable-o1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('line-v-dal')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('action-substitute')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('action-remove')));
    await tester.pumpAndSettle();
    expect(api.calls, ['remove o1 v-dal']);
    expect(find.text('₹150 refunded to the customer'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('unavailable-o1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('line-v-atta')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('action-substitute')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('sub-v-a2')), findsOneWidget);
    expect(find.byKey(const ValueKey('sub-v-a5')), findsNothing); // costs more
    expect(find.byKey(const ValueKey('sub-v-ragi')), findsNothing); // out of stock
    await tester.tap(find.byKey(const ValueKey('sub-v-a2')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'substitute o1 v-atta i-atta2/v-a2');
  });

  testWidgets('a realtime order.new refreshes and rings; the store can be paused and reopened', (tester) async {
    late FakeMerchantOrdersApi api;
    final realtime = FakeRealtime();
    final alerts = AlertCounter();
    final orders = <Map<String, dynamic>>[];
    final (container, _) = await pumpSignedIn(tester, view: _liveView(), orders: orders, onOrdersApi: (a) => api = a, realtime: realtime, alerts: alerts);
    expect(find.byKey(const ValueKey('waiting')), findsOneWidget);
    expect(alerts.rings, 0);

    api.orders.add(merchantOrder('o9', 'SN-9'));
    realtime.emit('order.new', {'orderId': 'o9'});
    await tester.pumpAndSettle();
    expect(find.text('New order · #SN-9'), findsOneWidget);
    expect(alerts.rings, 1);

    await tester.tap(find.byKey(const ValueKey('store-toggle')));
    await tester.pumpAndSettle();
    expect(api.calls, ['open false']);
    expect(find.text('Paused'), findsOneWidget);
    expect(find.byKey(const ValueKey('paused-banner')), findsOneWidget);
    await tester.tap(find.text('Open store'));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'open true');
    expect(container.read(storeOpenProvider), isTrue);
  });

  testWidgets('an auto-paused store explains why, in Telugu too', (tester) async {
    await pumpSignedIn(tester, locale: 'te', view: _liveView(open: false, pausedReason: 'missed_orders'));
    expect(find.text('ఆపివేయబడింది'), findsOneWidget);
    expect(find.text('ఆర్డర్లు మిస్ అయినందున మీ షాప్‌ను ఆపివేశాం. సిద్ధంగా ఉన్నప్పుడు తెరవండి.'), findsOneWidget);
    expect(find.text('ఈరోజు'), findsOneWidget);
  });

  testWidgets('M6: accepting asks how the order reaches the customer; self delivery picks a staff member', (tester) async {
    late FakeMerchantOrdersApi api;
    final view = _liveView();
    view['staff'] = [
      {'id': 'st1', 'name': 'Suresh', 'phoneMasked': '+9190******01'},
    ];
    await pumpSignedIn(tester, view: view, orders: [merchantOrder('o1', 'SN-7')], onOrdersApi: (a) => api = a);
    await tester.tap(find.byKey(const ValueKey('accept-o1')));
    await tester.pumpAndSettle();
    expect(find.text('How will this order reach the customer?'), findsOneWidget);
    expect(find.text('Lower commission · keep the delivery fee'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('mode-self')));
    await tester.pumpAndSettle();
    expect(find.text('Who delivers?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('confirm-accept')));
    await tester.pumpAndSettle();
    expect(api.calls, ['accept o1 self st1']);
    expect(find.text('Suresh delivers'), findsOneWidget);
    expect(find.byKey(const ValueKey('copy-link-o1')), findsOneWidget);
    expect(find.byKey(const ValueKey('pickup-code-o1')), findsNothing); // staff need no pickup code
  });

  testWidgets('M6: rider deliveries show the pickup code; no rider yet → bonus to deliver it yourself', (tester) async {
    late FakeMerchantOrdersApi api;
    await pumpSignedIn(tester, view: _liveView(), orders: [merchantOrder('o1', 'SN-8')], onOrdersApi: (a) => api = a);
    await tester.tap(find.byKey(const ValueKey('accept-o1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('mode-rider')));
    await tester.tap(find.byKey(const ValueKey('confirm-accept')));
    await tester.pumpAndSettle();
    expect(find.text('Looking for a rider…'), findsOneWidget);
    expect(find.text('Pickup code 4812'), findsOneWidget);

    api.deliveryRows['o1']!.addAll({'fallbackStage': 'self_bonus', 'selfBonusPaise': 2000});
    await tester.drag(find.byKey(const ValueKey('orders-list')), const Offset(0, 300));
    await tester.pumpAndSettle();
    expect(find.text('No rider yet. Deliver it yourself and earn a ₹20 bonus.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('deliver-myself-o1')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'deliver-myself o1');
    expect(find.text('Owner delivers'), findsOneWidget);

    api.deliveryRows['o1']!.addAll({'mode': 'rider', 'state': 'assigned', 'courier': {'kind': 'rider', 'name': 'Kiran', 'callNumber': '+918047100003'}, 'staffLink': null});
    await tester.drag(find.byKey(const ValueKey('orders-list')), const Offset(0, 300));
    await tester.pumpAndSettle();
    expect(find.text('Kiran is coming to pick up'), findsOneWidget);
  });

  testWidgets('M6: Earnings shows the statement preview with the commission ladder', (tester) async {
    late FakeMerchantOrdersApi api;
    await pumpSignedIn(tester, view: _liveView(), onOrdersApi: (a) => api = a);
    api.statementLines = [
      {'orderId': 'a', 'code': 'SN1', 'deliveredAt': '2026-11-02T07:00:00Z', 'mode': 'self', 'itemsPaise': 20000, 'commissionPercent': 6, 'commissionPaise': 1200, 'deliveryFeeCreditPaise': 2500, 'selfBonusPaise': 0, 'netPaise': 21300},
      {'orderId': 'b', 'code': 'SN2', 'deliveredAt': '2026-11-02T08:00:00Z', 'mode': 'rider', 'itemsPaise': 10000, 'commissionPercent': 9, 'commissionPaise': 900, 'deliveryFeeCreditPaise': 0, 'selfBonusPaise': 0, 'netPaise': 9100},
    ];
    await tester.tap(find.text('Earnings'));
    await tester.pumpAndSettle();
    expect(find.text('2 orders · you get ₹304'), findsOneWidget);
    expect(find.text('#SN1 · you get ₹213'), findsOneWidget);
    expect(find.text('Self delivery · items ₹200 · commission ₹12 (6%) + delivery fee ₹25'), findsOneWidget);
    expect(find.text('Santha rider · items ₹100 · commission ₹9 (9%)'), findsOneWidget);
  });

  testWidgets('M7: Earnings lists payouts with the tax lines and lets the store dispute a refund within 48 h', (tester) async {
    late FakeMerchantOrdersApi api;
    await pumpSignedIn(tester, view: _liveView(), onOrdersApi: (a) => api = a);
    api.payoutRows = [
      {
        'id': 'p1', 'periodStart': '2026-11-01T18:30:00.000Z', 'periodEnd': '2026-11-02T18:30:00.000Z', 'grossPaise': 50000, 'netPaise': 43890, 'status': 'transferred',
        'totals': {'itemsPaise': 50000, 'commissionPaise': 4500, 'cgstPaise': 405, 'sgstPaise': 405, 'tcsPaise': 250, 'tdsPaise': 50}, 'lines': <Object>[], 'hasStatement': true, 'transferRef': 'trf_1',
      },
    ];
    api.refundRows = [
      {'id': 'r1', 'orderCode': 'SN100', 'amountPaise': 6000, 'reason': 'missing_item:auto_small_trusted', 'disputable': true, 'processedAt': '2026-11-02T08:00:00.000Z'},
      {'id': 'r2', 'orderCode': 'SN090', 'amountPaise': 2000, 'reason': 'damaged:auto_small_trusted', 'disputable': false, 'processedAt': '2026-10-29T08:00:00.000Z'},
    ];
    await tester.tap(find.text('Earnings'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byKey(const ValueKey('payout-p1')), 200, scrollable: find.byType(Scrollable).last);
    expect(find.text('02/11 · ₹438.90'), findsOneWidget);
    expect(find.textContaining('Sent to your bank'), findsOneWidget);
    expect(find.textContaining('commission ₹45 + GST ₹8.10 · TCS ₹2.50 · TDS ₹0.50'), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('refund-r2')), 200, scrollable: find.byType(Scrollable).last);
    expect(find.byKey(const ValueKey('dispute-r2')), findsNothing); // older than 48 h
    await tester.tap(find.byKey(const ValueKey('dispute-r1')));
    await tester.pumpAndSettle();
    expect(tester.widget<SanthaButton>(find.byKey(const ValueKey('dispute-send'))).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('dispute-reason')), 'Both items were packed; counter CCTV shows it.');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('dispute-send')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'dispute r1');
    expect(find.text('Dispute sent — we will decide within 48 hours'), findsOneWidget);
  });

  testWidgets('M8: Earnings shows customer reviews; the store replies once', (tester) async {
    late FakeComplianceApi reviews;
    await pumpSignedIn(tester, view: _liveView(), overrides: [
      complianceApiProvider.overrideWith((ref) => reviews = FakeComplianceApi(ref.watch(apiClientProvider), [
            {'orderId': 'o1', 'storeStars': 4, 'comment': 'Fresh atta, a little late', 'reply': null, 'createdAt': '2026-11-02T08:00:00.000Z'},
          ])),
    ]);
    await tester.tap(find.text('Earnings'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byKey(const ValueKey('review-o1')), 200, scrollable: find.byType(Scrollable).last);
    expect(find.textContaining('Fresh atta, a little late'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('4 out of 5 stars')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('reply-o1')));
    await tester.pumpAndSettle();
    expect(tester.widget<SanthaButton>(find.byKey(const ValueKey('reply-send'))).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('reply-text')), 'Sorry for the wait — thank you!');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('reply-send')));
    await tester.pumpAndSettle();
    expect(reviews.replies.single, 'o1 Sorry for the wait — thank you!');
    expect(find.text('Reply posted'), findsOneWidget);
    expect(find.textContaining('Your reply: Sorry for the wait'), findsOneWidget);
    expect(find.byKey(const ValueKey('reply-o1')), findsNothing);
  });

  test('every bucket maps to its wire name', () {
    expect(OrderBucket.values.map((b) => b.wire), ['new', 'preparing', 'ready', 'out', 'done']);
  });
}
