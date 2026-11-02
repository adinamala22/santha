import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:consumer/app.dart';
import 'package:consumer/data/order_providers.dart';
import 'package:consumer/data/providers.dart';
import 'package:consumer/flavors.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_offline/santha_offline.dart';

/// API responses captured from `pnpm dev:fake` (shared with santha_api's contract tests).
Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('../../packages/santha_api/test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

const kiranaId = '10000000-0000-4000-8000-000000000201';
const kitchenId = '10000000-0000-4000-8000-000000000210';

/// Fake backend for widget tests: auth, serviceability, addresses, feed, search, store pages.
class FakeBackend implements HttpClientAdapter {
  bool offline = false;
  bool serviceable = true;
  final requests = <String>[];

  // M4 state
  String? cartMerchantId;
  bool paid = false;
  bool codOrder = false;
  final bodies = <String, Object?>{};

  // M5 state
  String? cancelReason;
  bool whatsapp = false;
  /// Applied to every order response (e.g. {'state': 'PREPARING'} to simulate the store moving it on).
  Map<String, dynamic> orderPatch = {};

  Map<String, dynamic> _order() {
    final Map<String, dynamic> o;
    if (codOrder) {
      o = {...fixture('order_placed'), 'paymentMethod': 'cod', 'payment': null};
    } else {
      o = fixture(paid ? 'order_placed' : 'order_awaiting_payment');
    }
    final state = cancelReason != null ? 'CANCELLED' : (orderPatch['state'] ?? o['state']);
    return {
      ...o,
      'canCancel': state == 'PLACED',
      'refundedPaise': cancelReason != null && !codOrder ? o['totalPaise'] : 0,
      'outcomeReason': cancelReason,
      ...orderPatch,
      'state': state,
    };
  }

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async {
    requests.add('${o.method} ${o.path}');
    if (offline && !o.path.startsWith('/v1/auth')) {
      throw DioException.connectionError(requestOptions: o, reason: 'offline');
    }
    final path = o.path;
    bodies['${o.method} $path'] = o.data;
    if (o.method == 'PUT' && path == '/v1/cart') cartMerchantId = (o.data as Map)['merchantId'] as String?;
    if (o.method == 'POST' && path == '/v1/orders') codOrder = (o.data as Map)['paymentMethod'] == 'cod';
    if (o.method == 'POST' && path.startsWith('/v1/dev/payments/') && path.endsWith('/succeed')) paid = true;
    final (status, body) = switch ('${o.method} $path') {
      'PUT /v1/cart' => (200, fixture('cart')),
      'POST /v1/cart/price' => (200, fixture(cartMerchantId == kitchenId ? 'checkout_kitchen' : 'checkout_retail')),
      'POST /v1/orders' => (201, _order()),
      'GET /v1/orders' => (200, {'items': [_order()]}),
      'GET /v1/wallet' => (200, fixture('wallet')),
      final r when r.startsWith('GET /v1/orders/') => (200, _order()),
      final r when r.startsWith('POST /v1/orders/') && r.endsWith('/cancel') => _order()['state'] == 'PLACED'
          ? (200, (() {
              cancelReason = (o.data as Map)['reason'] as String;
              return _order();
            })())
          : (409, <String, Object?>{'error': {'code': 'INVALID_STATE', 'message': 'The store has already started on this order.'}}),
      'GET /v1/me/notification-preferences' => (200, {'whatsappUpdates': whatsapp}),
      'PUT /v1/me/notification-preferences' => (200, {'whatsappUpdates': whatsapp = (o.data as Map)['whatsappUpdates'] as bool}),
      final r when r.startsWith('POST /v1/dev/payments/') =>
        (200, {...(fixture('order_placed')['payment'] as Map<String, dynamic>), 'status': path.endsWith('/succeed') ? 'captured' : 'created', 'lastFailure': path.endsWith('/fail') ? 'Payment declined by the bank (mock)' : null}),
      final r when r.startsWith('POST /v1/orders/') && r.endsWith('/abandon-payment') => (200, {...fixture('order_awaiting_payment'), 'state': 'PAYMENT_FAILED'}),
      'POST /v1/auth/otp/request' => (200, {'challengeId': 'c1', 'expiresInSec': 300, 'resendAfterSec': 30}),
      'POST /v1/auth/otp/verify' => (
          200,
          {
            'accessToken': 'a',
            'refreshToken': 'r',
            'accessExpiresIn': 900,
            'refreshExpiresIn': 2592000,
            'isNewUser': false,
            'user': {'id': 'u1', 'phoneMasked': '+9190******01', 'name': null, 'locale': 'en', 'roles': [thisApp.name]},
          }
        ),
      'GET /v1/serviceability' => (
          200,
          {
            'serviceable': serviceable,
            'microMarket': serviceable ? fixture('feed_stores')['serviceability']['microMarket'] : null,
            'waitlist': false,
          }
        ),
      'GET /v1/me/addresses' => (200, fixture('address_list')),
      'GET /v1/feed' => (200, fixture(o.queryParameters['tab'] == 'home_kitchens' ? 'feed_kitchens' : 'feed_stores')),
      'GET /v1/search' => (200, fixture('search_atta')),
      'GET /v1/stores/$kiranaId' => (200, fixture('store_kirana')),
      'GET /v1/stores/$kitchenId' => (200, fixture('store_kitchen')),
      _ => (404, <String, Object?>{'error': {'code': 'NOT_FOUND', 'message': 'not found'}}),
    };
    return ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

class Harness {
  Harness(this.container, this.backend, this.analytics, [this.realtime]);
  final FakeRealtime? realtime;
  final ProviderContainer container;
  final FakeBackend backend;
  final DebugAnalytics analytics;
  List<String> get events => analytics.events.map((e) => e.$1).toList();
}

Future<void> settle(WidgetTester tester, [int frames = 12]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Boots the app on a phone-sized screen. With [signIn], walks the OTP flow first.
Future<Harness> pumpApp(WidgetTester tester, {bool signIn = true, String locale = 'en', Map<String, String> kv = const {}, FakeRealtime? realtime}) async {
  tester.view.physicalSize = const Size(1080, 3000); // 360 × 1000 dp
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  final backend = FakeBackend();
  final analytics = DebugAnalytics();
  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(configFor(Flavor.dev)),
      keyValueStoreProvider.overrideWithValue(MemoryKeyValueStore({'santha.locale': locale, ...kv})),
      deviceIdProvider.overrideWithValue('test-device-0001'),
      realtimeProvider.overrideWithValue(realtime ?? FakeRealtime()),
      orderPollEveryProvider.overrideWithValue(null),
      analyticsProvider.overrideWithValue(analytics),
      jsonCacheProvider.overrideWith((ref) async => JsonCache(MemoryCacheStorage())),
      apiClientProvider.overrideWith(
        (ref) => SanthaApiClient(
          baseUrl: 'http://api.test',
          deviceId: 'test-device-0001',
          tokens: ref.watch(tokenStoreProvider),
          dio: Dio()..httpClientAdapter = backend,
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const SanthaConsumerApp()));
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));

  if (signIn) {
    await tester.enterText(find.byKey(const ValueKey('phone')), '9000000001');
    await tester.tap(find.byType(FilledButton).first);
    await settle(tester, 2);
    await tester.enterText(find.byKey(const ValueKey('code')), '123456');
    await tester.tap(find.byType(FilledButton).first);
    await settle(tester);
    await tester.pump(const Duration(seconds: 31)); // resend countdown timer
    await settle(tester);
  }
  return Harness(container, backend, analytics, realtime);
}

/// Signs in and picks the seeded default address (Dargamitta) → home.
Future<Harness> pumpAtHome(WidgetTester tester, {String locale = 'en', Map<String, String> kv = const {}, FakeRealtime? realtime}) async {
  final h = await pumpApp(tester, locale: locale, kv: kv, realtime: realtime);
  await tester.tap(find.textContaining('Sai Residency'));
  await settle(tester, 20);
  return h;
}

/// Taps a widget after scrolling it into view (the test font is wider than Poppins).
Future<void> tapVisible(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await settle(tester, 4);
  await tester.tap(f);
  await settle(tester);
}
