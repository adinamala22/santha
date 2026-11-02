import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_core/santha_core.dart';

import 'support/harness.dart';

void main() {
  testWidgets('signed-out users land on OTP login and can sign in end to end', (tester) async {
    final h = await pumpApp(tester, signIn: false);
    expect(find.text('Sign in'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('phone')), '9876543210');
    await tester.tap(find.text('Send code'));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.enterText(find.byKey(const ValueKey('code')), '123456');
    await tester.tap(find.text('Verify and continue'));
    await settle(tester);

    expect(h.container.read(authControllerProvider), isA<AuthSignedIn>());
    expect(find.text('Where should we deliver?'), findsOneWidget); // no delivery location yet
    await tester.pump(const Duration(seconds: 31)); // let the resend countdown finish
  });

  testWidgets('switches the UI to Telugu', (tester) async {
    await pumpApp(tester, signIn: false);
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
