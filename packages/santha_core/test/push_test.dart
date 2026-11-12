import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

/// Records push-token calls; signs in; logs out.
class _Backend implements HttpClientAdapter {
  final calls = <String>[];
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async {
    calls.add('${o.method} ${o.path}${o.data is Map && (o.data as Map).containsKey('token') ? ' ${(o.data as Map)['token']}' : ''}');
    final (status, body) = switch ('${o.method} ${o.path}') {
      'POST /v1/auth/otp/verify' => (
          200,
          <String, Object?>{
            'accessToken': 'a1',
            'refreshToken': 'r1',
            'accessExpiresIn': 900,
            'refreshExpiresIn': 2592000,
            'isNewUser': false,
            'user': {'id': 'u1', 'phoneMasked': '+9198******10', 'name': null, 'locale': 'en', 'roles': ['merchant']},
          }
        ),
      _ => (o.method == 'GET' ? 404 : 204, <String, Object?>{}),
    };
    return ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

class _FakePush implements PushMessaging {
  final refresh = StreamController<String>.broadcast();
  final taps = StreamController<PushTap>.broadcast();
  String? current = 'fcm-token-1';
  PushTap? opened;
  bool allowed = true;
  int asked = 0;

  @override
  Future<bool> requestPermission() async {
    asked++;
    return allowed;
  }

  @override
  Future<String?> token() async => current;
  @override
  Stream<String> get onTokenRefresh => refresh.stream;
  @override
  Stream<PushTap> get onTap => taps.stream;
  @override
  Future<PushTap?> initialTap() async => opened;
}

void main() {
  late _Backend backend;
  late _FakePush push;
  late ProviderContainer container;

  setUp(() {
    backend = _Backend();
    push = _FakePush();
    container = ProviderContainer(overrides: [
      appConfigProvider.overrideWithValue(const AppConfig(flavor: Flavor.dev, app: SanthaApp.merchant, apiBaseUrl: 'http://api.test')),
      keyValueStoreProvider.overrideWithValue(MemoryKeyValueStore()),
      deviceIdProvider.overrideWithValue('device-test-1'),
      pushMessagingProvider.overrideWithValue(push),
      apiClientProvider.overrideWith(
        (ref) => SanthaApiClient(baseUrl: 'http://api.test', deviceId: 'device-test-1', tokens: ref.watch(tokenStoreProvider), dio: Dio()..httpClientAdapter = backend),
      ),
    ]);
    addTearDown(container.dispose);
  });

  // Generous: CI machines are slow, and a fixed 20 ms made this suite flaky.
  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 250));

  test('after sign-in the phone registers its token; a rotated token is sent again; sign-out unregisters first', () async {
    container.read(pushSyncProvider);
    final reg = container.read(pushRegistrationProvider);
    await settle();
    expect(backend.calls.where((c) => c.contains('push-token')), isEmpty); // nobody signed in yet

    await container.read(authControllerProvider.notifier).verifyOtp(challengeId: 'c1', code: '123456');
    await settle();
    expect(push.asked, 1);
    expect(backend.calls, contains('PUT /v1/me/push-token fcm-token-1'));
    expect(reg.registered, isTrue);

    push.refresh.add('fcm-token-2');
    await settle();
    expect(backend.calls, contains('PUT /v1/me/push-token fcm-token-2'));

    await container.read(authControllerProvider.notifier).signOut();
    final del = backend.calls.indexOf('DELETE /v1/me/push-token');
    expect(del, greaterThanOrEqualTo(0));
    expect(del, lessThan(backend.calls.indexOf('POST /v1/auth/logout'))); // still signed in when it runs
    expect(reg.registered, isFalse);

    push.refresh.add('fcm-token-3'); // signed out: not sent
    await settle();
    expect(backend.calls, isNot(contains('PUT /v1/me/push-token fcm-token-3')));
  });

  test('no token (notifications not allowed, no Play services): nothing is sent and sign-out still works', () async {
    push.current = null;
    push.allowed = false;
    container.read(pushSyncProvider);
    await container.read(authControllerProvider.notifier).verifyOtp(challengeId: 'c1', code: '123456');
    await settle();
    expect(backend.calls.where((c) => c.contains('push-token')), isEmpty);
    await container.read(authControllerProvider.notifier).signOut();
    expect(backend.calls, isNot(contains('DELETE /v1/me/push-token')));
    expect(container.read(authControllerProvider), isA<AuthSignedOut>());
  });

  test('taps: the one that opened the app first, then taps while it runs', () async {
    push.opened = const PushTap({'kind': 'order', 'orderId': 'o1'});
    final seen = <PushTap>[];
    final sub = container.listen(pushTapsProvider, (_, next) {
      if (next.value != null) seen.add(next.value!);
    }, fireImmediately: true);
    await settle();
    push.taps.add(const PushTap({'kind': 'new_order', 'orderId': 'o2'}));
    await settle();
    sub.close();
    expect(seen.map((t) => '${t.kind}:${t.orderId}'), ['order:o1', 'new_order:o2']);
  });

  test('Firebase settings come from the build; without them push is off', () {
    expect(const FirebaseSettings(apiKey: '', appId: '', senderId: '', projectId: '').configured, isFalse);
    expect(const FirebaseSettings(apiKey: 'k', appId: '1:2:android:3', senderId: '2', projectId: 'santha').configured, isTrue);
    expect(FirebaseSettings.fromEnvironment().configured, isFalse); // tests run without --dart-define
  });
}
