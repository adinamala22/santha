import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:rider/app.dart';
import 'package:rider/flavors.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

/// Minimal fake of the backend auth endpoints.
class _FakeBackend implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async {
    final (status, body) = switch ('${o.method} ${o.path}') {
      'POST /v1/auth/otp/request' => (200, {'challengeId': 'c1', 'expiresInSec': 300, 'resendAfterSec': 30}),
      'POST /v1/auth/otp/verify' => (
          200,
          {
            'accessToken': 'a',
            'refreshToken': 'r',
            'accessExpiresIn': 900,
            'refreshExpiresIn': 2592000,
            'isNewUser': true,
            'user': {'id': 'u1', 'phoneMasked': '+9198******10', 'name': null, 'locale': 'en', 'roles': [thisApp.name]},
          }
        ),
      _ => (404, <String, Object?>{}),
    };
    return ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

Future<ProviderContainer> pumpApp(WidgetTester tester) async {
  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(configFor(Flavor.dev)),
      keyValueStoreProvider.overrideWithValue(MemoryKeyValueStore({'santha.locale': 'en'})),
      deviceIdProvider.overrideWithValue('test-device-0001'),
      apiClientProvider.overrideWith(
        (ref) => SanthaApiClient(
          baseUrl: 'http://api.test',
          deviceId: 'test-device-0001',
          tokens: ref.watch(tokenStoreProvider),
          dio: Dio()..httpClientAdapter = _FakeBackend(),
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const SanthaRiderApp()));
  await tester.pump(); // session restore → signed out → redirect to /login
  await tester.pump(const Duration(seconds: 1)); // let the splash → login page transition finish
  return container;
}

void main() {
  testWidgets('signed-out users land on OTP login and can sign in end to end', (tester) async {
    final container = await pumpApp(tester);
    expect(find.text('Sign in'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('phone')), '9876543210');
    await tester.tap(find.text('Send code'));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.enterText(find.byKey(const ValueKey('code')), '123456');
    await tester.tap(find.text('Verify and continue'));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));

    expect(container.read(authControllerProvider), isA<AuthSignedIn>());
    expect(find.text('Signed in as +9198******10'), findsOneWidget);
    await tester.pump(const Duration(seconds: 31)); // let the resend countdown finish
  });

  testWidgets('switches the UI to Telugu', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('తెలుగు'));
    await tester.pump();
    expect(find.text('సైన్ ఇన్ చేయండి'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
  });

  test('every English string has a Telugu translation', () {
    Map<String, dynamic> load(String lang) =>
        jsonDecode(File('lib/l10n/app_$lang.arb').readAsStringSync()) as Map<String, dynamic>;
    Set<String> keys(Map<String, dynamic> m) => m.keys.where((k) => !k.startsWith('@')).toSet();
    final en = load('en');
    final te = load('te');
    expect(keys(te), keys(en));
    for (final k in keys(en)) {
      expect((te[k] as String).trim(), isNotEmpty, reason: k);
    }
  });
}
