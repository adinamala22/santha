import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

/// Scripted HTTP adapter: route → handler returning (status, json body).
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.routes);

  final Map<String, (int, Object?) Function(RequestOptions)> routes;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    final handler = routes['${options.method} ${options.path}'];
    if (handler == null) return ResponseBody.fromString('{}', 404, headers: _json);
    final (status, body) = handler(options);
    return ResponseBody.fromString(jsonEncode(body), status, headers: _json);
  }

  static const _json = {
    Headers.contentTypeHeader: [Headers.jsonContentType],
  };

  @override
  void close({bool force = false}) {}
}

Map<String, Object?> tokens(String n) =>
    {'accessToken': 'access-$n', 'refreshToken': 'refresh-$n', 'accessExpiresIn': 900, 'refreshExpiresIn': 2592000};

const me = {'id': 'u1', 'phoneMasked': '+9198******10', 'name': null, 'locale': 'en', 'roles': ['consumer']};

void main() {
  late MemoryTokenStore store;
  late FakeAdapter adapter;
  late SanthaApiClient client;
  late AuthApi auth;
  var expired = 0;

  SanthaApiClient build(Map<String, (int, Object?) Function(RequestOptions)> routes) {
    adapter = FakeAdapter(routes);
    store = MemoryTokenStore();
    expired = 0;
    client = SanthaApiClient(
      baseUrl: 'http://api.test',
      deviceId: 'device-1234',
      tokens: store,
      onSessionExpired: () => expired++,
      dio: Dio()..httpClientAdapter = adapter,
    );
    auth = AuthApi(client, app: SanthaApp.merchant, platform: ClientPlatform.android);
    return client;
  }

  test('OTP request/verify sends device + app, stores tokens, then calls /me with bearer', () async {
    build({
      'POST /v1/auth/otp/request': (_) => (200, {'challengeId': 'c1', 'expiresInSec': 300, 'resendAfterSec': 30}),
      'POST /v1/auth/otp/verify': (_) => (200, {...tokens('1'), 'user': me, 'isNewUser': true}),
      'GET /v1/me': (_) => (200, me),
    });
    final ch = await auth.requestOtp(phone: '9876543210', locale: 'te');
    expect(ch.challengeId, 'c1');
    final req = adapter.requests.first;
    expect(req.headers['X-Device-Id'], 'device-1234');
    expect(req.headers.containsKey('Authorization'), isFalse);
    expect(req.data, containsPair('app', 'merchant'));
    expect(req.data, containsPair('locale', 'te'));

    final session = await auth.verifyOtp(challengeId: 'c1', code: '123456');
    expect(session.isNewUser, isTrue);
    expect((await store.read())!.accessToken, 'access-1');

    await auth.me();
    expect(adapter.requests.last.headers['Authorization'], 'Bearer access-1');
  });

  test('maps the backend error envelope to ApiException', () async {
    build({
      'POST /v1/auth/otp/verify': (_) => (
            400,
            {
              'error': {'code': 'OTP_INVALID', 'message': 'x', 'details': {'remainingAttempts': 3}},
            }
          ),
    });
    await expectLater(
      auth.verifyOtp(challengeId: 'c1', code: '000000'),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'OTP_INVALID').having((e) => e.remainingAttempts, 'left', 3)),
    );
  });

  test('refreshes once for concurrent 401s and retries both requests', () async {
    var refreshCalls = 0;
    build({
      'GET /v1/me': (o) => o.headers['Authorization'] == 'Bearer access-2' ? (200, me) : (401, {'error': {'code': 'UNAUTHENTICATED'}}),
      'POST /v1/auth/refresh': (o) {
        refreshCalls++;
        expect((o.data as Map)['deviceId'], 'device-1234');
        return (200, tokens('2'));
      },
    });
    await store.write(TokenPair.fromJson(tokens('1')));
    final results = await Future.wait([auth.me(), auth.me()]);
    expect(results.map((m) => m.id), ['u1', 'u1']);
    expect(refreshCalls, 1);
    expect((await store.read())!.refreshToken, 'refresh-2');
  });

  test('a failed refresh clears tokens and reports session expiry', () async {
    build({
      'GET /v1/me': (_) => (401, {'error': {'code': 'UNAUTHENTICATED'}}),
      'POST /v1/auth/refresh': (_) => (401, {'error': {'code': 'REFRESH_INVALID'}}),
    });
    await store.write(TokenPair.fromJson(tokens('1')));
    await expectLater(auth.me(), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(await store.read(), isNull);
    expect(expired, 1);
  });

  test('logout clears local tokens even when offline', () async {
    build({});
    adapter.routes['POST /v1/auth/logout'] = (_) => throw DioException.connectionError(
          requestOptions: RequestOptions(),
          reason: 'offline',
        );
    await store.write(TokenPair.fromJson(tokens('1')));
    await auth.logout();
    expect(await store.read(), isNull);
  });
}
