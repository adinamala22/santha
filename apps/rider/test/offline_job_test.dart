import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rider/features/home/data/offline_rider_api.dart';
import 'package:rider/features/home/data/rider_controller.dart';
import 'package:rider/features/home/presentation/offline_banner.dart';
import 'package:rider/l10n/gen/app_localizations.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_offline/santha_offline.dart';

/// The deliveries in hand stay readable when the network drops (ADR-035).

Map<String, dynamic> _job(String id, {String state = 'assigned', String orderState = 'PREPARING'}) => {
      'id': id,
      'orderId': 'ord-$id',
      'code': 'SN$id',
      'mode': 'rider',
      'state': state,
      'orderState': orderState,
      'store': {'name': 'Ramesh Stores', 'line': '14-2-31, Dargamitta', 'lat': 14.4545, 'lng': 79.992},
      'drop': {'name': 'Priya', 'line': 'Flat 3B, Magunta Layout', 'landmark': 'near Apollo', 'lat': 14.46, 'lng': 79.99},
      'itemCount': 3,
      'codDuePaise': 0,
      'payPaise': 4800,
      'payLines': [
        {'code': 'base', 'amountPaise': 3000},
      ],
      'callNumber': '+918047112345',
      'pickupCodeRequired': true,
    };

Map<String, dynamic> _home(List<Map<String, dynamic>> jobs) => {
      'name': 'Kiran',
      'vehicle': 'bike',
      'online': true,
      'zones': <Map<String, dynamic>>[],
      'allZones': <Map<String, dynamic>>[],
      'today': {'deliveries': 1, 'earningsPaise': 4800, 'onlineMin': 30},
      'jobs': jobs,
    };

/// The network, scripted: [down] makes every call fail like a phone with no signal.
class _Net extends OfflineRiderApi {
  _Net(super.client, super.cache, super.onState);
  bool down = false;
  Object? refuse;
  Map<String, dynamic> homeBody = _home([]);
  final jobBodies = <String, Map<String, dynamic>>{};

  void _check() {
    if (refuse != null) throw refuse!;
    if (down) throw const ApiException(code: ApiException.network, status: 0);
  }

  @override
  Future<Json> homeJson() async {
    _check();
    return homeBody;
  }

  @override
  Future<Json> jobJson(String id) async {
    _check();
    return jobBodies[id]!;
  }
}

SanthaApiClient _client() => SanthaApiClient(baseUrl: 'http://api.test', deviceId: 'test-device-0001', tokens: MemoryTokenStore());

void main() {
  late JsonCache cache;
  late _Net api;
  DateTime? since;
  final saved = DateTime.utc(2026, 11, 9, 10);

  setUp(() {
    cache = JsonCache(MemoryCacheStorage(), clock: () => saved);
    since = null;
    api = _Net(_client(), () async => cache, (s) => since = s);
  });

  test('ACCEPTANCE: with no network the home and the job open from the saved copy, with when it was saved', () async {
    api.homeBody = _home([_job('a')]);
    api.jobBodies['a'] = _job('a');
    expect((await api.home()).jobs.single.code, 'SNa');
    expect(since, isNull); // online: nothing to flag

    api.down = true;
    final home = await api.home();
    expect(home.jobs.single.dropLine, 'Flat 3B, Magunta Layout'); // the address is still there
    expect(since, saved);
    since = null;
    final job = await api.job('a'); // saved with the home, even if never opened
    expect(job.dropName, 'Priya');
    expect(since, saved);

    api.down = false;
    await api.home();
    expect(since, isNull); // back online: the flag clears
  });

  test('an offer is not kept: it has expired and cannot be answered without the network', () async {
    api.homeBody = _home([_job('a')]);
    await api.home();
    // Put a half-formed offer into the saved copy: reading it would throw, so it must be dropped first.
    final stored = Map<String, dynamic>.from((await cache.get('rider_home'))!.value! as Map);
    stored['offer'] = {'id': 'o1'};
    await cache.put('rider_home', stored);
    api.down = true;
    expect((await api.home()).offer, isNull);
  });

  test('only a network failure falls back: a refusal from the server is shown as it is', () async {
    api.homeBody = _home([_job('a')]);
    await api.home();
    api.refuse = const ApiException(code: 'UNAUTHENTICATED', status: 401);
    await expectLater(api.home(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UNAUTHENTICATED')));
    api.refuse = const ApiException(code: 'NOT_FOUND', status: 404);
    await expectLater(api.job('a'), throwsA(isA<ApiException>()));
    expect(since, isNull);
  });

  test('nothing saved and no network: the error is shown, not an empty screen', () async {
    api.down = true;
    await expectLater(api.home(), throwsA(isA<ApiException>().having((e) => e.code, 'code', ApiException.network)));
    await expectLater(api.job('zzz'), throwsA(isA<ApiException>()));
  });

  test('a finished delivery is forgotten: its copy goes when it leaves the home, and when it is delivered', () async {
    api.homeBody = _home([_job('a'), _job('b')]);
    api.jobBodies['a'] = _job('a');
    api.jobBodies['b'] = _job('b');
    await api.home();
    expect(await cache.get('job_a'), isNotNull);

    api.homeBody = _home([_job('b')]); // a is no longer in hand
    await api.home();
    expect(await cache.get('job_a'), isNull);
    expect(await cache.get('job_b'), isNotNull);

    api.jobBodies['b'] = _job('b', state: 'delivered', orderState: 'DELIVERED');
    await api.job('b');
    expect(await cache.get('job_b'), isNull);
  });

  test('signing out empties the phone', () async {
    api.homeBody = _home([_job('a')]);
    await api.home();
    await cache.clear();
    expect(await cache.get('rider_home'), isNull);
    expect(await cache.get('job_a'), isNull);
    api.down = true;
    await expectLater(api.home(), throwsA(isA<ApiException>()));
  });

  test('without storage the app still works online', () async {
    final plain = _Net(_client(), () async => throw StateError('no disk'), (s) => since = s);
    plain.homeBody = _home([_job('a')]);
    expect((await plain.home()).jobs, hasLength(1));
    plain.down = true;
    await expectLater(plain.home(), throwsA(isA<ApiException>()));
  });

  testWidgets('the banner says how old the saved copy is, in English and Telugu, and hides when online', (tester) async {
    final now = DateTime.utc(2026, 11, 9, 10, 7);
    Future<void> show(Locale locale, DateTime? at) => tester.pumpWidget(ProviderScope(
          key: UniqueKey(), // a fresh scope each time, or the first state would be kept
          overrides: [riderOfflineProvider.overrideWith(() => _Fixed(at)), riderNowProvider.overrideWith((ref) => Stream.value(now))],
          child: MaterialApp(
            locale: locale,
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            home: const Scaffold(body: OfflineBanner()),
          ),
        ));

    await show(const Locale('en'), null);
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const ValueKey('offline-banner')), findsNothing);

    await show(const Locale('en'), saved);
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('7 min ago'), findsOneWidget);
    expect(find.textContaining('needs internet'), findsOneWidget);

    await show(const Locale('te'), saved);
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('7 నిమిషాల క్రితం'), findsOneWidget);
  });
}

class _Fixed extends RiderOffline {
  _Fixed(this.at);
  final DateTime? at;
  @override
  DateTime? build() => at;
}
