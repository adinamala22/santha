import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

/// M8 (widget level): the login notice, Terms + Privacy consent recorded after sign-in, and Account →
/// Privacy and help (marketing opt-in, download my data, delete my account, grievances).
void main() {
  testWidgets('login shows the Terms/Privacy notice', (tester) async {
    await pumpApp(tester, signIn: false);
    expect(find.byKey(const ValueKey('login-consent')), findsOneWidget);
    expect(find.textContaining('santha.in/legal'), findsOneWidget);
  });

  testWidgets('ACCEPTANCE: consent is recorded after sign-in; privacy and help works end to end', (tester) async {
    final h = await pumpAtHome(tester);
    expect(h.backend.consents, {'terms': true, 'privacy': true});

    await tester.tap(find.text('Account').last);
    await settle(tester, 10);
    await tapVisible(tester, find.byKey(const ValueKey('privacy-help')));
    await settle(tester, 10);
    expect(find.text('Your privacy'), findsOneWidget);
    expect(find.textContaining('grievance@santha.in'), findsOneWidget);

    // Marketing is off until the customer says yes.
    expect(tester.widget<SwitchListTile>(find.byKey(const ValueKey('marketing-consent'))).value, isFalse);
    await tester.tap(find.byKey(const ValueKey('marketing-consent')));
    await settle(tester, 6);
    expect(h.backend.consents['marketing'], isTrue);
    expect(tester.widget<SwitchListTile>(find.byKey(const ValueKey('marketing-consent'))).value, isTrue);

    // Download my data: an access request whose export is summarised on screen.
    await tester.tap(find.byKey(const ValueKey('download-data')));
    await settle(tester, 6);
    expect(find.byKey(const ValueKey('data-summary')), findsOneWidget);
    expect(find.textContaining('2 addresses'), findsOneWidget);
    expect(find.textContaining('1 order'), findsOneWidget);

    // Grievance: the button waits for a real description.
    await tester.enterText(find.byKey(const ValueKey('grievance-text')), 'short');
    await tester.pump();
    expect(find.text('Send to the grievance officer'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('grievance-text')), 'My refund for the atta has not arrived yet.');
    await tester.pump();
    await tapVisible(tester, find.text('Send to the grievance officer'));
    await settle(tester, 8);
    expect(h.backend.grievances.single['description'], 'My refund for the atta has not arrived yet.');
    expect(find.byKey(const ValueKey('grievance-grv1')), findsOneWidget);
    expect(h.events, containsAll(['consent_changed', 'data_export_requested', 'grievance_raised']));

    // Delete my account: confirmed, then a second request is refused while the first is open.
    await tapVisible(tester, find.byKey(const ValueKey('delete-account')));
    await settle(tester, 4);
    expect(find.text('Delete your account?'), findsOneWidget);
    await tester.tap(find.text('Delete'));
    await settle(tester, 6);
    expect(h.backend.dataRequests.where((r) => r['type'] == 'erasure'), hasLength(1));
    expect(find.text('Request received. We will confirm within 7 days.'), findsOneWidget);
    await settle(tester, 100); // let the snackbar go
    await tapVisible(tester, find.byKey(const ValueKey('delete-account')));
    await settle(tester, 4);
    await tester.tap(find.text('Delete'));
    await settle(tester, 6);
    expect(find.text('You already have this request open.'), findsOneWidget);
  });

  testWidgets('privacy and help in Telugu', (tester) async {
    await pumpAtHome(tester, locale: 'te');
    await tester.tap(find.byIcon(Icons.person_outline));
    await settle(tester, 10);
    await tapVisible(tester, find.byKey(const ValueKey('privacy-help')));
    await settle(tester, 10);
    expect(find.text('మీ గోప్యత'), findsOneWidget);
    expect(find.text('ఫిర్యాదు చేయండి'), findsOneWidget);
  });
}
