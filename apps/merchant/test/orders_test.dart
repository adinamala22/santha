import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:merchant/features/catalogue/data/catalogue_controller.dart';
import 'package:merchant/features/orders/data/orders_controller.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import 'catalogue_test.dart' show FakeCatalogueApi;
import 'onboarding_test.dart' show FakeMerchantApi, pumpSignedIn;
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
    expect(api.calls, ['accept o1']);
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
    expect(api.calls, ['accept o1']);
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

  test('every bucket maps to its wire name', () {
    expect(OrderBucket.values.map((b) => b.wire), ['new', 'preparing', 'ready', 'out', 'done']);
  });
}
