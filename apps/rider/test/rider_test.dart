import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rider/app.dart';
import 'package:rider/flavors.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import 'support/fake_rider.dart';

/// Answers GET /v1/me so the session restores as a signed-in rider.
class _MeBackend implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async => ResponseBody.fromString(
        jsonEncode({'id': 'u1', 'phoneMasked': '+9190******02', 'name': 'Kiran', 'locale': 'en', 'roles': ['rider']}),
        200,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
      );
  @override
  void close({bool force = false}) {}
}

Future<(ProviderContainer, FakeRiderApi)> pumpRider(
  WidgetTester tester, {
  FakeRiderApi Function(SanthaApiClient)? make,
  String locale = 'en',
  FakeRealtime? realtime,
  Counter? rings,
  List<Uri>? launched,
}) async {
  late FakeRiderApi api;
  final tokens = MemoryTokenStore();
  await tokens.write(const TokenPair(accessToken: 'a', refreshToken: 'r', accessExpiresIn: 900, refreshExpiresIn: 99999));
  tester.view.physicalSize = const Size(1236, 2745);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(overrides: [
    appConfigProvider.overrideWithValue(configFor(Flavor.dev)),
    keyValueStoreProvider.overrideWithValue(MemoryKeyValueStore({'santha.locale': locale})),
    deviceIdProvider.overrideWithValue('test-device-0001'),
    tokenStoreProvider.overrideWithValue(tokens),
    apiClientProvider.overrideWith((ref) => SanthaApiClient(baseUrl: 'http://api.test', deviceId: 'test-device-0001', tokens: ref.watch(tokenStoreProvider), dio: Dio()..httpClientAdapter = _MeBackend())),
    ...riderOverrides(make ?? (c) => FakeRiderApi(c), onApi: (a) => api = a, realtime: realtime, rings: rings, launched: launched),
  ]);
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const SanthaRiderApp()));
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
  await tester.pumpAndSettle();
  return (container, api);
}

void main() {
  testWidgets('going online asks for zones, then waits for orders', (tester) async {
    final (container, api) = await pumpRider(tester);
    expect(find.text('Kiran'), findsOneWidget);
    expect(find.text('You are offline. Go online to get orders near you.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('online-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('Where will you work today?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('zone-z1')));
    await tester.tap(find.byKey(const ValueKey('go-online')));
    await tester.pumpAndSettle();
    expect(api.calls, ['status true z1', 'location']);
    expect(find.text('Online · Dargamitta'), findsOneWidget);
    expect(find.text('Waiting for orders near you…'), findsOneWidget);
    expect(find.text('Today · 0 deliveries · ₹0 · online 5 h 20 m'), findsOneWidget);
    expect(find.text('Your rating 4.8 ★'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('Your rating: 4.8 out of 5')), findsOneWidget);
    final events = (container.read(analyticsProvider) as DebugAnalytics).events.map((e) => e.$1);
    expect(events, contains('online_toggled'));
  });

  testWidgets('an offer rings with pay breakdown and countdown; accepting opens the job', (tester) async {
    final rings = Counter();
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, offer: testOffer()), rings: rings);
    expect(rings.n, 1);
    expect(find.text('New order · ₹48'), findsOneWidget);
    expect(find.text('Pickup: Ramesh Stores · 0.6 km · ready in 5 min'), findsOneWidget);
    expect(find.text('Drop: Magunta Layout · 1.1 km'), findsOneWidget);
    expect(find.text('Base ₹30 + distance ₹14 + second order ₹4'), findsOneWidget);
    expect(find.text('Accept 00:24'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('accept-offer')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('accept o1'));
    expect(find.text('Go to the store'), findsOneWidget);
    expect(find.text('The store is still packing. Please wait here.'), findsOneWidget);
  });

  testWidgets('a declined or expired offer goes away', (tester) async {
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, offer: testOffer()));
    await tester.tap(find.byKey(const ValueKey('decline-offer')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('decline o1'));
    expect(find.byKey(const ValueKey('offer-o1')), findsNothing);
  });

  testWidgets('job: pickup code (wrong, not ready, right), then OTP and cash for COD, then delivered', (tester) async {
    final launched = <Uri>[];
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, jobs: [testJob()]), launched: launched);
    await tester.tap(find.byKey(const ValueKey('job-j1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('arrived')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('arrived'));

    await tester.enterText(find.byKey(const ValueKey('pickup-code')), '1111');
    await tester.tap(find.byKey(const ValueKey('picked-up')));
    await tester.pumpAndSettle();
    expect(find.text('That code is not right. Check and try again.'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('pickup-code')), '4812');
    await tester.tap(find.byKey(const ValueKey('picked-up')));
    await tester.pumpAndSettle();
    expect(find.text('The store is still packing this order.'), findsOneWidget);
    api.ready = true;
    await tester.enterText(find.byKey(const ValueKey('pickup-code')), '4812');
    await tester.tap(find.byKey(const ValueKey('picked-up')));
    await tester.pumpAndSettle();

    expect(find.text('Deliver to the customer'), findsOneWidget);
    expect(find.text('Flat 3B, Magunta Layout, near Apollo Pharmacy'), findsOneWidget);
    expect(find.text('Note: Leave at door if no answer; call first'), findsOneWidget);
    expect(find.text('COD: collect ₹156'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('call-customer')));
    await tester.tap(find.byKey(const ValueKey('navigate-drop')));
    expect(launched.map((u) => u.scheme), ['tel', 'https']);
    expect(launched.first.toString(), 'tel:+918047112345');

    await tester.enterText(find.byKey(const ValueKey('delivery-otp')), '1357');
    await tester.tap(find.byKey(const ValueKey('mark-delivered')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('job-error')), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('delivery-otp')), '2468');
    await tester.tap(find.byKey(const ValueKey('mark-delivered')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'delivered 2468 15600');
    expect(find.text('Delivered. Well done!'), findsOneWidget);
  });

  testWidgets('earnings list today’s deliveries with their pay', (tester) async {
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true));
    api.deliveries = 1;
    api.earned = 4800;
    await tester.tap(find.byTooltip('Earnings today'));
    await tester.pumpAndSettle();
    expect(find.text('₹48 from 1 delivery'), findsOneWidget);
    expect(find.text('#SN4821 · ₹48'), findsOneWidget);
    expect(find.text('Base ₹30 + distance ₹18'), findsOneWidget);
    expect(find.text('No payouts yet. Payouts run every Monday for the week before.'), findsOneWidget);
  });

  testWidgets('a realtime offer refreshes the home; Telugu works', (tester) async {
    final realtime = FakeRealtime();
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true), realtime: realtime, locale: 'te');
    expect(find.text('మీ దగ్గర ఆర్డర్ల కోసం ఎదురుచూస్తున్నాం…'), findsOneWidget);
    api.offer = testOffer(id: 'o2');
    realtime.emit('offer.new', {'offerId': 'o2'});
    await tester.pumpAndSettle();
    expect(find.text('కొత్త ఆర్డర్ · ₹48'), findsOneWidget);
  });

  testWidgets('M7: earnings show weekly payouts with cash held deducted', (tester) async {
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true));
    api.payoutList = [
      Payout.fromJson({
        'id': 'p1', 'periodStart': '2026-10-25T18:30:00.000Z', 'periodEnd': '2026-11-01T18:30:00.000Z', 'grossPaise': 74200, 'netPaise': 58600, 'status': 'transferred',
        'totals': {'earnedPaise': 74200, 'cashHeldPaise': 15600, 'adjustmentsPaise': 0}, 'lines': <Object>[], 'hasStatement': true, 'transferRef': 'trf_1',
      }),
    ];
    await tester.tap(find.byTooltip('Earnings today'));
    await tester.pumpAndSettle();
    expect(find.text('26/10 – 01/11 · ₹586'), findsOneWidget);
    expect(find.text('Earned ₹742 − cash you held ₹156'), findsOneWidget);
  });
}
