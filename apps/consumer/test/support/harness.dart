import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:consumer/app.dart';
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

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async {
    requests.add('${o.method} ${o.path}');
    if (offline && !o.path.startsWith('/v1/auth')) {
      throw DioException.connectionError(requestOptions: o, reason: 'offline');
    }
    final path = o.path;
    final (status, body) = switch ('${o.method} $path') {
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
  Harness(this.container, this.backend, this.analytics);
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
Future<Harness> pumpApp(WidgetTester tester, {bool signIn = true, String locale = 'en', Map<String, String> kv = const {}}) async {
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
  return Harness(container, backend, analytics);
}

/// Signs in and picks the seeded default address (Dargamitta) → home.
Future<Harness> pumpAtHome(WidgetTester tester, {String locale = 'en'}) async {
  final h = await pumpApp(tester, locale: locale);
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
