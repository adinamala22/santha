import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:merchant/app.dart';
import 'package:merchant/features/onboarding/data/onboarding_controller.dart';
import 'package:merchant/flavors.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import 'support/fake_orders.dart';

/// Answers GET /v1/me so the session restores as a signed-in merchant.
class _MeBackend implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async => ResponseBody.fromString(
        jsonEncode({'id': 'u1', 'phoneMasked': '+9198******10', 'name': null, 'locale': 'en', 'roles': ['merchant']}),
        200,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
      );
  @override
  void close({bool force = false}) {}
}

/// In-memory stand-in for the backend's onboarding rules (kept deliberately small).
class FakeMerchantApi extends MerchantApi {
  FakeMerchantApi(super.client, {this.view});

  Map<String, dynamic>? view;
  final calls = <String>[];

  static Map<String, dynamic> build({
    String type = 'home_kitchen',
    String status = 'draft',
    bool sellsFood = true,
    List<Map<String, dynamic>> kyc = const [],
    List<(String, bool)>? checklist,
    String? rejectionCode,
    Map<String, dynamic>? microMarket,
    Map<String, dynamic>? location,
  }) =>
      {
        'merchant': {
          'id': 'm1', 'type': type, 'sellsFood': sellsFood, 'category': null, 'name': "Lakshmi's Kitchen", 'nameTe': null,
          'description': null, 'addressLine': null, 'landmark': null, 'pincode': null, 'location': location, 'radiusM': 3000,
          'hours': null, 'movPaise': 0, 'defaultFulfilment': 'rider', 'returnPolicy': null, 'hygieneDeclaredAt': null,
          'status': status, 'submittedAt': null, 'decidedAt': null, 'rejectionCode': rejectionCode, 'rejectionNote': null,
          'liveAt': null, 'createdAt': '2026-11-01T00:00:00.000Z',
        },
        'microMarket': microMarket,
        'staff': <Object>[],
        'kyc': kyc,
        'checklist': [
          for (final (k, d) in checklist ??
              [('business', true), ('location', false), ('hours', false), ('pan', false), ('aadhaar', false), ('gst', false), ('fssai', false), ('bank', false), ('hygiene', false)])
            {'key': k, 'done': d},
        ],
        'canSubmit': (checklist ?? const []).isNotEmpty && checklist!.every((c) => c.$2) && (status == 'draft' || status == 'rejected'),
      };

  static Map<String, dynamic> check(String kind, String status, {String? reason, String? masked}) => {
        'kind': kind, 'status': status, 'valueMasked': masked, 'valuePublic': null, 'nameOnRecord': null, 'provider': 'mock',
        'failureReason': reason, 'details': null, 'verifiedAt': status == 'verified' ? '2026-11-01T00:00:00.000Z' : null,
        'updatedAt': '2026-11-01T00:00:00.000Z',
      };

  void _mark(String key) => (view!['checklist'] as List).cast<Map<String, dynamic>>().where((c) => c['key'] == key).forEach((c) => c['done'] = true);

  @override
  Future<MerchantView?> mine() async => view == null ? null : MerchantView.fromJson(jsonDecode(jsonEncode(view)) as Map<String, dynamic>);

  @override
  Future<MerchantView> create({required MerchantType type, required String name, bool? sellsFood, String? category}) async {
    calls.add('create ${type.wire} $name food=$sellsFood');
    view = build(type: type.wire, sellsFood: type == MerchantType.homeKitchen || (sellsFood ?? false));
    (view!['merchant'] as Map)['name'] = name;
    return (await mine())!;
  }

  @override
  Future<MerchantView> update(Map<String, Object?> patch) async {
    calls.add('update ${patch.keys.join(',')}');
    final m = view!['merchant'] as Map<String, dynamic>;
    if (patch['location'] != null) {
      m['location'] = patch['location'];
      view!['microMarket'] = {'id': 'mm1', 'slug': 'dargamitta', 'name': 'Dargamitta', 'nameTe': 'దర్గామిట్ట'};
    }
    if (patch.containsKey('addressLine')) _mark('location');
    if (patch.containsKey('deliversAnywhere')) m['deliversAnywhere'] = patch['deliversAnywhere'];
    if (patch['hours'] != null) {
      m['hours'] = patch['hours'];
      m['openUntil'] = null;
    }
    return (await mine())!;
  }

  @override
  Future<KycCheck> verifyPan({required String pan, required String name}) async {
    calls.add('pan $pan');
    final ok = pan.substring(5, 9) != '0000';
    final c = check('pan', ok ? 'verified' : 'failed', reason: ok ? null : 'PAN not found in the income tax records', masked: 'AB******4K');
    view!['kyc'] = [...(view!['kyc'] as List).where((k) => k['kind'] != 'pan'), c];
    if (ok) _mark('pan');
    return KycCheck.fromJson(c);
  }

  @override
  Future<MerchantView> submit() async {
    calls.add('submit');
    (view!['merchant'] as Map)['status'] = 'submitted';
    return (await mine())!;
  }
}

Future<(ProviderContainer, FakeMerchantApi)> pumpSignedIn(
  WidgetTester tester, {
  Map<String, dynamic>? view,
  String locale = 'en',
  LocationReader? location,
  List<Override> overrides = const [],
  List<Map<String, dynamic>> orders = const [],
  void Function(FakeMerchantOrdersApi)? onOrdersApi,
  FakeRealtime? realtime,
  AlertCounter? alerts,
}) async {
  late FakeMerchantApi api;
  final tokens = MemoryTokenStore();
  await tokens.write(const TokenPair(accessToken: 'a', refreshToken: 'r', accessExpiresIn: 900, refreshExpiresIn: 99999));
  // A typical Android phone (412 x 915 dp), so lists show what a user would see.
  tester.view.physicalSize = const Size(1236, 2745);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(overrides: [
    appConfigProvider.overrideWithValue(configFor(Flavor.dev)),
    keyValueStoreProvider.overrideWithValue(MemoryKeyValueStore({'santha.locale': locale})),
    deviceIdProvider.overrideWithValue('test-device-0001'),
    tokenStoreProvider.overrideWithValue(tokens),
    apiClientProvider.overrideWith((ref) => SanthaApiClient(
          baseUrl: 'http://api.test',
          deviceId: 'test-device-0001',
          tokens: ref.watch(tokenStoreProvider),
          dio: Dio()..httpClientAdapter = _MeBackend(),
        )),
    merchantApiProvider.overrideWith((ref) => api = FakeMerchantApi(ref.watch(apiClientProvider), view: view)),
    if (location != null) locationReaderProvider.overrideWithValue(location),
    ...orderOverrides(orders: [...orders], view: view ?? const {}, onApi: onOrdersApi ?? (_) {}, realtime: realtime, alerts: alerts),
    ...overrides,
  ]);
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const SanthaMerchantApp()));
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
  await tester.pumpAndSettle();
  container.read(merchantApiProvider); // ensure the fake exists
  return (container, api);
}

void main() {
  testWidgets('a new home cook picks a type and lands on the checklist with food-seller steps', (tester) async {
    final (container, api) = await pumpSignedIn(tester);
    expect(find.text('Set up your shop'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('type-home_kitchen')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('sells-food')), findsNothing); // kitchens always sell food
    await tester.enterText(find.byKey(const ValueKey('shop-name')), "Lakshmi's Kitchen");
    await tester.scrollUntilVisible(find.text('Continue'), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(api.calls.single, "create home_kitchen Lakshmi's Kitchen food=null");
    expect(find.text('Finish setting up'), findsOneWidget);
    expect(find.byKey(const ValueKey('step-fssai')), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('step-hygiene')), 200, scrollable: find.byType(Scrollable).first);
    expect(find.byKey(const ValueKey('step-hygiene')), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('submit')), 200, scrollable: find.byType(Scrollable).first);
    expect(tester.widget<SanthaButton>(find.byKey(const ValueKey('submit'))).onPressed, isNull); // not until every step is done
    expect(find.text('Finish every step to submit.'), findsOneWidget);
    final events = (container.read(analyticsProvider) as DebugAnalytics).events;
    expect(events.single.$1, 'onboarding_step_completed');
  });

  testWidgets('PAN: a failed check shows the reason; a verified one returns to the checklist', (tester) async {
    final (_, api) = await pumpSignedIn(tester, view: FakeMerchantApi.build());
    await tester.tap(find.byKey(const ValueKey('step-pan')));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('pan')), 'ABCPL0000K');
    await tester.enterText(find.byKey(const ValueKey('pan-name')), 'Lakshmi Devi');
    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();
    expect(find.text('Not verified: PAN not found in the income tax records'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('pan')), 'abcpl1234k'); // upper-cased as typed
    await tester.tap(find.text('Verify'));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'pan ABCPL1234K');
    expect(find.text('Finish setting up'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('step-pan')), matching: find.text('Done')), findsOneWidget);
  });

  testWidgets('location: GPS resolves the micro-market', (tester) async {
    await pumpSignedIn(tester, view: FakeMerchantApi.build(), location: () async => LocationOk(14.4525, 79.995));
    await tester.tap(find.byKey(const ValueKey('step-location')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('use-gps')));
    await tester.pumpAndSettle();
    expect(find.text('Your shop is in Dargamitta'), findsOneWidget);
  });

  testWidgets('location: denied permission explains what to do', (tester) async {
    await pumpSignedIn(tester, view: FakeMerchantApi.build(), location: () async => LocationDenied());
    await tester.tap(find.byKey(const ValueKey('step-location')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('use-gps')));
    await tester.pumpAndSettle();
    expect(find.text('Allow location access to place your shop on the map.'), findsOneWidget);
  });

  testWidgets('a failed FSSAI check is flagged on the checklist', (tester) async {
    await pumpSignedIn(tester, view: FakeMerchantApi.build(kyc: [FakeMerchantApi.check('fssai', 'failed', reason: 'expired')]));
    await tester.scrollUntilVisible(find.byKey(const ValueKey('step-fssai')), 200, scrollable: find.byType(Scrollable).first);
    expect(find.descendant(of: find.byKey(const ValueKey('step-fssai')), matching: find.text('Check again')), findsOneWidget);
  });

  testWidgets('complete checklist → submit → under review', (tester) async {
    final all = [('business', true), ('location', true), ('hours', true), ('pan', true), ('aadhaar', true), ('gst', true), ('fssai', true), ('bank', true), ('hygiene', true)];
    final (_, api) = await pumpSignedIn(tester, view: FakeMerchantApi.build(checklist: all));
    await tester.scrollUntilVisible(find.byKey(const ValueKey('submit')), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('submit')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'submit');
    expect(find.text('Thanks! We are checking your details'), findsOneWidget);
  });

  testWidgets('a store sent back shows the reason', (tester) async {
    await pumpSignedIn(tester, view: FakeMerchantApi.build(status: 'rejected', rejectionCode: 'fssai_invalid'));
    expect(find.byKey(const ValueKey('rejected-banner')), findsOneWidget);
    expect(find.text('Your FSSAI number is invalid or expired.'), findsOneWidget);
  });

  testWidgets('a live store sees its micro-market, in Telugu too', (tester) async {
    await pumpSignedIn(
      tester,
      locale: 'te',
      view: FakeMerchantApi.build(status: 'live', microMarket: {'id': 'mm1', 'slug': 'dargamitta', 'name': 'Dargamitta', 'nameTe': 'దర్గామిట్ట'}),
    );
    await tester.tap(find.text('మరిన్ని'));
    await tester.pumpAndSettle();
    expect(find.text('మీరు సంతలో లైవ్‌లో ఉన్నారు'), findsOneWidget);
    expect(find.textContaining('దర్గామిట్ట'), findsOneWidget);
  });
}
