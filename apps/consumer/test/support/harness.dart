import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:consumer/app.dart';
import 'package:consumer/data/order_providers.dart';
import 'package:consumer/features/orders/tracking_view.dart';
import 'package:consumer/data/providers.dart';
import 'package:consumer/features/location/location_controller.dart';
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
  /// Body of the last POST /v1/orders (ADR-032: the tip).
  Map<String, dynamic>? lastOrderBody;

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

  /// Fee rows added to the priced bill (e.g. the beyond-radius charge, ADR-022).
  List<Map<String, dynamic>> extraFees = [];

  /// Tip after delivery (ADR-037): what the server says, and what was sent / paid.
  bool tipAllowed = true;
  int tippedPaise = 0;
  Map<String, dynamic>? lastTipBody;

  // M6 state: the tracking response (null → 404 until the store accepts).
  Map<String, dynamic>? tracking;
  bool cancelledNoCourier = false;

  // M7 state
  final issues = <Map<String, dynamic>>[];
  Map<String, dynamic>? rating;

  Map<String, dynamic>? _rating() => rating == null
      ? null
      : {'orderId': _order()['id'], 'storeStars': rating!['storeStars'], 'riderStars': rating!['riderStars'], 'comment': rating!['comment'], 'createdAt': '2026-11-02T08:00:00.000Z'};

  // Ratings: the kirana's rating on its card/page (null keeps the captured fixture as is).
  ({double avg, int count})? kiranaRating;

  /// Fields merged into the kirana's card in the feed and search (e.g. deliverable: false, ADR-021).
  Map<String, dynamic> kiranaCardPatch = {};

  /// Fields merged into the kirana store page (e.g. deliversHere / notDeliveringReason).
  Map<String, dynamic> kiranaPagePatch = {};

  // Support chat state (ADR-028)
  final supportThreads = <Map<String, dynamic>>[];

  // M8 state
  final consents = <String, bool>{};
  final grievances = <Map<String, dynamic>>[];
  final dataRequests = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _consents() => [
        for (final e in consents.entries) {'purpose': e.key, 'granted': e.value, 'current': true, 'at': '2026-11-02T08:00:00.000Z'},
      ];

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

  /// The captured feed, with the kirana's rating applied and `minRating` filtered like the API does.
  Map<String, dynamic> _feed(Map<String, dynamic> q) {
    final feed = fixture(q['tab'] == 'home_kitchens' ? 'feed_kitchens' : 'feed_stores');
    var stores = (feed['stores'] as List).cast<Map<String, dynamic>>();
    if (kiranaRating case final k?) stores = [for (final s in stores) s['id'] == kiranaId ? {...s, 'rating': k.avg, 'ratingCount': k.count} : s];
    stores = [for (final s in stores) s['id'] == kiranaId ? {...s, ...kiranaCardPatch} : s];
    final min = q['minRating'] as num?;
    if (min != null) stores = stores.where((s) => s['rating'] != null && (s['rating'] as num) >= min).toList();
    return {...feed, 'stores': stores};
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
      'POST /v1/cart/price' => (200, (() {
          final q = fixture(cartMerchantId == kitchenId ? 'checkout_kitchen' : 'checkout_retail');
          if (extraFees.isNotEmpty) (q['bill']['fees'] as List).insertAll(1, extraFees);
          return q;
        })()),
      'POST /v1/orders' => (() {
          lastOrderBody = Map<String, dynamic>.from(o.data as Map);
          final tip = (lastOrderBody!['tipPaise'] as int?) ?? 0;
          final placed = _order();
          return (201, {...placed, 'tipPaise': tip, 'totalPaise': (placed['totalPaise'] as int) + tip});
        })(),
      'GET /v1/orders' => (200, {'items': [_order()]}),
      'GET /v1/wallet' => (200, fixture('wallet')),
      final r when r.startsWith('GET /v1/orders/') && r.endsWith('/tracking') =>
        tracking == null ? (404, <String, Object?>{'error': {'code': 'NOT_FOUND', 'message': 'No delivery yet'}}) : (200, tracking!),
      final r when r.startsWith('POST /v1/orders/') && r.endsWith('/cancel-no-courier') => (() {
          cancelledNoCourier = true;
          orderPatch = {...orderPatch, 'state': 'CANCELLED'};
          tracking = null;
          return (204, <String, Object?>{});
        })(),
      final r when r.startsWith('POST /v1/orders/') && r.endsWith('/issues') => (() {
          final b = o.data as Map;
          final type = b['type'] as String;
          final lines = (_order()['lines'] as List).cast<Map<String, dynamic>>();
          final claimed = lines.where((l) => ((b['variantIds'] as List?) ?? const []).contains(l['variantId'])).fold<int>(0, (s, l) => s + (l['linePaise'] as int));
          final auto = type != 'not_delivered' && claimed <= 30000;
          final issue = {
            'id': 'iss${issues.length + 1}', 'orderId': _order()['id'], 'type': type, 'variantIds': b['variantIds'] ?? <String>[], 'description': b['description'],
            'claimedPaise': claimed, 'status': auto ? 'auto_resolved' : 'pending_review', 'refundPaise': claimed, 'refundDestination': 'wallet',
            'reason': auto ? 'auto_small_trusted' : 'needs_investigation', 'createdAt': '2026-11-02T08:00:00.000Z', 'decidedAt': auto ? '2026-11-02T08:00:00.000Z' : null,
          };
          if (issues.any((i) => i['type'] == type)) return (409, <String, Object?>{'error': {'code': 'ALREADY_EXISTS', 'message': 'dup'}});
          issues.add(issue);
          return (201, issue);
        })(),
      final r when r.startsWith('GET /v1/orders/') && r.endsWith('/issues') => (200, {'items': issues}),
      final r when r.startsWith('POST /v1/orders/') && r.endsWith('/rating') => (() {
          if (rating != null) return (409, <String, Object?>{'error': {'code': 'ALREADY_EXISTS', 'message': 'You already rated this order.'}});
          rating = Map<String, dynamic>.from(o.data as Map);
          return (201, _rating()!);
        })(),
      final r when r.startsWith('GET /v1/orders/') && r.endsWith('/rating') => (200, {'rating': _rating()}),
      final r when r.startsWith('GET /v1/orders/') && r.endsWith('/tip') => (200, {
          'canTip': tipAllowed && tippedPaise == 0,
          'reason': tippedPaise > 0 ? 'already_tipped' : (tipAllowed ? 'ok' : 'window_closed'),
          'until': null,
          'tippedPaise': tippedPaise,
          'choicesPaise': [1000, 2000, 3000, 5000, 10000],
          'minPaise': 1000,
          'maxPaise': 20000,
        }),
      final r when r.startsWith('POST /v1/orders/') && r.endsWith('/tip') => (() {
          lastTipBody = Map<String, dynamic>.from(o.data as Map);
          return (200, {'intentId': 'tip-1', 'provider': 'mock', 'providerOrderId': 'order_tip_1', 'keyId': null, 'amountPaise': lastTipBody!['amountPaise'], 'currency': 'INR', 'status': 'created', 'lastFailure': null});
        })(),
      'POST /v1/dev/tips/tip-1/succeed' => (() {
          tippedPaise = lastTipBody!['amountPaise'] as int;
          return (200, {'intentId': 'tip-1', 'provider': 'mock', 'providerOrderId': 'order_tip_1', 'keyId': null, 'amountPaise': tippedPaise, 'currency': 'INR', 'status': 'captured', 'lastFailure': null});
        })(),
      final r when r.startsWith('GET /v1/orders/') => (200, _order()),
      final r when r.startsWith('POST /v1/orders/') && r.endsWith('/cancel') => _order()['state'] == 'PLACED'
          ? (200, (() {
              cancelReason = (o.data as Map)['reason'] as String;
              return _order();
            })())
          : (409, <String, Object?>{'error': {'code': 'INVALID_STATE', 'message': 'The store has already started on this order.'}}),
      'GET /v1/me/consents' => (200, {'items': _consents()}),
      'PUT /v1/me/consents' => (() {
          final b = o.data as Map;
          consents[b['purpose'] as String] = b['granted'] as bool;
          return (200, {'items': _consents()});
        })(),
      'GET /v1/me/grievances' => (200, {'items': grievances}),
      'POST /v1/me/grievances' => (() {
          final b = o.data as Map;
          final g = {
            'id': 'grv${grievances.length + 1}', 'category': b['category'], 'description': b['description'], 'status': 'open', 'resolution': null,
            'resolveDueAt': '2026-12-02T08:00:00.000Z', 'createdAt': '2026-11-02T08:00:00.000Z',
          };
          grievances.insert(0, g);
          return (201, g);
        })(),
      'GET /v1/me/data-requests' => (200, {'items': dataRequests}),
      'POST /v1/me/data-requests' => (() {
          final type = (o.data as Map)['type'] as String;
          if (dataRequests.any((r) => r['type'] == type && r['status'] == 'open')) return (409, <String, Object?>{'error': {'code': 'ALREADY_EXISTS', 'message': 'open'}});
          final r = {'id': 'dr${dataRequests.length + 1}', 'type': type, 'status': type == 'access' ? 'completed' : 'open', 'exportReady': type == 'access', 'createdAt': '2026-11-02T08:00:00.000Z'};
          dataRequests.add(r);
          return (201, r);
        })(),
      final r when r.startsWith('GET /v1/me/data-requests/') && r.endsWith('/export') =>
        (200, {'account': {'id': 'u1'}, 'addresses': fixture('address_list')['items'], 'orders': [_order()], 'consents': _consents()}),
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
            'matchedBy': serviceable ? 'area' : null,
            'reason': serviceable ? null : 'outside_service_area',
            'nearest': serviceable ? null : {'name': 'Magunta Layout', 'nameTe': 'మాగుంట లేఅవుట్', 'distanceM': 3500},
          }
        ),
      'GET /v1/me/addresses' => (200, fixture('address_list')),
      final r when r.startsWith('DELETE /v1/me/addresses/') => (204, <String, Object?>{}),
      'POST /v1/me/addresses' => (201, {
          ...(fixture('address_list')['items'] as List).first as Map<String, dynamic>,
          'id': '80000000-0000-4000-8000-000000000099',
          'line': (o.data as Map)['line'],
          'location': (o.data as Map)['location'],
          'isDefault': false,
        }),
      // Support chat (ADR-028): opening returns the new thread; the list holds what was opened.
      'GET /v1/support/threads' => (200, {'items': supportThreads}),
      'POST /v1/support/threads' => (() {
          final b = o.data as Map;
          final t = <String, dynamic>{
            'id': 'th${supportThreads.length + 1}', 'app': 'consumer', 'orderId': b['orderId'], 'orderCode': b['orderId'] == null ? null : _order()['code'],
            'topic': b['topic'], 'status': 'waiting_support', 'lastMessageAt': '2026-11-05T10:00:00.000Z', 'lastMessagePreview': b['body'],
            'unreadByUser': 0, 'resolvedAt': null, 'createdAt': '2026-11-05T10:00:00.000Z',
          };
          supportThreads.insert(0, t);
          return (201, {...t, 'messages': [{'id': 'sm1', 'author': 'user', 'body': b['body'], 'createdAt': '2026-11-05T10:00:00.000Z'}]});
        })(),
      final r when r.startsWith('GET /v1/support/threads/') => (200, {...supportThreads.first, 'messages': [{'id': 'sm1', 'author': 'user', 'body': supportThreads.first['lastMessagePreview'], 'createdAt': '2026-11-05T10:00:00.000Z'}]}),
      'GET /v1/feed' => (200, _feed(o.queryParameters)),
      'GET /v1/search' => (200, (() {
          final r = fixture('search_atta');
          for (final g in (r['groups'] as List).cast<Map<String, dynamic>>()) {
            if ((g['store'] as Map)['id'] == kiranaId) g['store'] = {...(g['store'] as Map<String, dynamic>), ...kiranaCardPatch};
          }
          return r;
        })()),
      'GET /v1/stores/$kiranaId/reviews' => (200, fixture('store_reviews_public')),
      'GET /v1/stores/$kiranaId' => (200, (() {
          final page = fixture('store_kirana');
          if (kiranaRating case final k?) page['store'] = {...page['store'] as Map<String, dynamic>, 'rating': k.avg, 'ratingCount': k.count};
          page.addAll(kiranaPagePatch);
          return page;
        })()),
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

/// GPS stand-in: answers with [result] and counts calls.
class FakeLocator implements DeviceLocator {
  FakeLocator(this.result);
  LocateResult result;
  int calls = 0;
  @override
  Future<LocateResult> locate() async {
    calls++;
    return result;
  }
}

/// Numbers the app tried to call (masked numbers only).
final dialled = <String>[];

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
Future<Harness> pumpApp(WidgetTester tester, {bool signIn = true, String locale = 'en', Map<String, String> kv = const {}, FakeRealtime? realtime, DeviceLocator? locator, void Function(FakeBackend)? prepare}) async {
  tester.view.physicalSize = const Size(1080, 3000); // 360 × 1000 dp
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  final backend = FakeBackend();
  prepare?.call(backend);
  final analytics = DebugAnalytics();
  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(configFor(Flavor.dev)),
      keyValueStoreProvider.overrideWithValue(MemoryKeyValueStore({'santha.locale': locale, ...kv})),
      deviceIdProvider.overrideWithValue('test-device-0001'),
      realtimeProvider.overrideWithValue(realtime ?? FakeRealtime()),
      orderPollEveryProvider.overrideWithValue(null),
      trackingMapEnabledProvider.overrideWithValue(false),
      dialerProvider.overrideWithValue((n) async => dialled.add(n)),
      analyticsProvider.overrideWithValue(analytics),
      if (locator != null) deviceLocatorProvider.overrideWithValue(locator),
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
Future<Harness> pumpAtHome(WidgetTester tester, {String locale = 'en', Map<String, String> kv = const {}, FakeRealtime? realtime, void Function(FakeBackend)? prepare}) async {
  final h = await pumpApp(tester, locale: locale, kv: kv, realtime: realtime, prepare: prepare);
  await tester.tap(find.textContaining('Sai Residency'));
  await settle(tester, 20);
  return h;
}

/// Taps a widget after scrolling it into view (the test font is wider than Poppins).
Future<void> tapVisible(WidgetTester tester, Finder f) async {
  // Centre it: at the edge it can sit under a pinned app bar and the tap would hit that instead.
  await Scrollable.ensureVisible(tester.element(f), alignment: 0.5);
  await settle(tester, 4);
  await tester.tap(f);
  await settle(tester);
}
