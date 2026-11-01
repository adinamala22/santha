import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

class _Backend implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  String validCode = '123456';

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async {
    requests.add(o);
    final (status, body) = switch ('${o.method} ${o.path}') {
      'POST /v1/auth/otp/request' => (200, {'challengeId': 'c1', 'expiresInSec': 300, 'resendAfterSec': 30}),
      'POST /v1/auth/otp/verify' when (o.data as Map)['code'] == validCode => (
          200,
          {
            'accessToken': 'a1',
            'refreshToken': 'r1',
            'accessExpiresIn': 900,
            'refreshExpiresIn': 2592000,
            'isNewUser': true,
            'user': {'id': 'u1', 'phoneMasked': '+9198******10', 'name': null, 'locale': 'en', 'roles': ['consumer']},
          }
        ),
      'POST /v1/auth/otp/verify' => (
          400,
          {
            'error': {'code': 'OTP_INVALID', 'message': 'x', 'details': {'remainingAttempts': 4}},
          }
        ),
      _ => (404, {}),
    };
    return ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

const strings = OtpLoginStrings(
  title: 'Sign in',
  subtitle: 'Enter your mobile number',
  phoneLabel: 'Mobile number',
  phoneHint: '98765 43210',
  sendCode: 'Send code',
  codeTitle: 'Enter the code',
  codeSubtitle: _sentTo,
  codeLabel: '6-digit code',
  verify: 'Verify',
  resend: 'Resend code',
  resendIn: _resendIn,
  changeNumber: 'Change number',
  errorInvalidPhone: 'Enter a valid 10-digit mobile number',
  errorInvalidCode: 'Enter the 6-digit code',
  errorWrongCode: 'That code is not right',
  errorExpired: 'Code expired',
  errorTooManyAttempts: 'Too many attempts',
  errorRateLimited: 'Please wait',
  errorBlocked: 'Account not active',
  errorNetwork: 'No connection',
  errorGeneric: 'Something went wrong',
  sessionExpired: 'Please sign in again',
);
String _sentTo(String p) => 'Sent to $p';
String _resendIn(String t) => 'Resend in $t';

void main() {
  late _Backend backend;
  late ProviderContainer container;

  Future<void> pump(WidgetTester tester) async {
    backend = _Backend();
    final kv = MemoryKeyValueStore();
    container = ProviderContainer(
      overrides: [
        appConfigProvider.overrideWithValue(
          const AppConfig(flavor: Flavor.dev, app: SanthaApp.consumer, apiBaseUrl: 'http://api.test'),
        ),
        keyValueStoreProvider.overrideWithValue(kv),
        deviceIdProvider.overrideWithValue('device-test-1'),
        apiClientProvider.overrideWith(
          (ref) => SanthaApiClient(
            baseUrl: 'http://api.test',
            deviceId: 'device-test-1',
            tokens: ref.watch(tokenStoreProvider),
            dio: Dio()..httpClientAdapter = backend,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: santhaTheme(),
          home: const OtpLoginScreen(strings: strings, header: Text('Santha')),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('starts signed out when there are no stored tokens', (tester) async {
    await pump(tester);
    expect(container.read(authControllerProvider), isA<AuthSignedOut>());
  });

  testWidgets('validates the phone number locally', (tester) async {
    await pump(tester);
    await tester.enterText(find.byKey(const ValueKey('phone')), '12345');
    await tester.tap(find.text('Send code'));
    await tester.pump();
    expect(find.text('Enter a valid 10-digit mobile number'), findsOneWidget);
    expect(backend.requests, isEmpty);
  });

  testWidgets('phone → code → signed in; wrong code shows a friendly error', (tester) async {
    await pump(tester);
    await tester.enterText(find.byKey(const ValueKey('phone')), '9876543210');
    await tester.tap(find.text('Send code'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Sent to +91 98765 43210'), findsOneWidget);
    expect(find.text('Resend in 0:30'), findsOneWidget);
    expect(backend.requests.single.headers['X-Device-Id'], 'device-test-1');

    await tester.enterText(find.byKey(const ValueKey('code')), '000000');
    await tester.tap(find.text('Verify'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('That code is not right'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('code')), '123456');
    await tester.tap(find.text('Verify'));
    await tester.pump(const Duration(milliseconds: 100));
    final state = container.read(authControllerProvider);
    expect(state, isA<AuthSignedIn>());
    expect((state as AuthSignedIn).me.roles, ['consumer']);

    // countdown timer still running — advance past it so no timers are pending at teardown
    await tester.pump(const Duration(seconds: 31));
  });
}
