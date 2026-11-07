import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rider/features/home/presentation/job_page.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import 'rider_test.dart' show pumpRider;
import 'support/fake_rider.dart';

/// Rider audit 2026-11-07: onboarding (B2, ADR-029) and the app-side bug fixes (B3–B8).
void main() {
  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.ensureVisible(find.byKey(ValueKey(key)));
    await tester.tap(find.byKey(ValueKey(key)));
    await tester.pumpAndSettle();
  }

  testWidgets('B2: a new rider signs up step by step (bike, PAN, licence, bank), submits and waits for approval', (tester) async {
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, status: RiderStatus.draft));
    expect(find.byKey(const ValueKey('rider-onboarding')), findsOneWidget);
    expect(find.byKey(const ValueKey('online-toggle')), findsNothing); // no going online before approval
    expect(find.text('Finish all the steps first.'), findsOneWidget);

    // Name and vehicle: a wrong number plate is explained, then fixed.
    await tapKey(tester, 'step-profile');
    await tester.enterText(find.byKey(const ValueKey('onb-name')), 'Kiran Kumar');
    await tester.enterText(find.byKey(const ValueKey('onb-plate')), '1234');
    await tapKey(tester, 'onb-save-profile');
    expect(find.text('Please check what you entered and try again.'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('onb-plate')), 'ap 26 ab 4321');
    await tapKey(tester, 'onb-save-profile');
    expect(api.calls, contains('profile Kiran Kumar bike ap 26 ab 4321'));
    expect(find.textContaining('Kiran Kumar · Motorbike · AP26AB4321'), findsOneWidget);

    // A selfie with the front camera (ADR-030).
    await tapKey(tester, 'step-selfie');
    expect(api.calls, contains('photo selfie'));
    expect(find.textContaining('Photo added'), findsOneWidget);

    // Identity with PAN.
    await tapKey(tester, 'step-identity');
    await tapKey(tester, 'onb-identity-switch');
    await tester.enterText(find.byKey(const ValueKey('onb-pan')), 'abcpk1234k');
    await tester.enterText(find.byKey(const ValueKey('onb-pan-name')), 'Kiran Kumar');
    await tapKey(tester, 'onb-pan-go');
    expect(api.calls, contains('pan ABCPK1234K'));

    await tapKey(tester, 'step-driving_licence');
    await tester.enterText(find.byKey(const ValueKey('onb-licence')), 'AP26 2019 0012345');
    await tapKey(tester, 'onb-licence-photo'); // the card, for ops to compare
    expect(api.calls, contains('photo licence'));
    await tapKey(tester, 'onb-save-licence');
    expect(find.textContaining('Added, we will check it'), findsOneWidget);

    await tapKey(tester, 'step-bank');
    await tester.enterText(find.byKey(const ValueKey('onb-account')), '1234 5678 9012');
    await tester.enterText(find.byKey(const ValueKey('onb-ifsc')), 'sbin0001234');
    await tester.enterText(find.byKey(const ValueKey('onb-holder')), 'Kiran Kumar');
    await tapKey(tester, 'onb-save-bank');
    expect(api.calls, contains('bank 123456789012 SBIN0001234'));

    await tapKey(tester, 'onb-submit');
    expect(api.calls.last, 'submit');
    expect(find.byKey(const ValueKey('rider-submitted')), findsOneWidget);
    expect(find.text('Thanks! We are checking your details'), findsOneWidget);
  });

  testWidgets('B2: Aadhaar with OTP: a wrong code asks for a new OTP; a cycle needs no licence', (tester) async {
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, status: RiderStatus.draft)..selfie = true);
    await tapKey(tester, 'step-profile');
    await tester.enterText(find.byKey(const ValueKey('onb-name')), 'Ravi');
    await tapKey(tester, 'vehicle-cycle');
    expect(find.byKey(const ValueKey('onb-plate')), findsNothing);
    await tapKey(tester, 'onb-save-profile');
    expect(find.text('Not needed for a cycle'), findsOneWidget);

    await tapKey(tester, 'step-identity');
    await tester.enterText(find.byKey(const ValueKey('onb-aadhaar')), '234567890123');
    await tapKey(tester, 'onb-aadhaar-go');
    await tester.enterText(find.byKey(const ValueKey('onb-aadhaar-otp')), '000000');
    await tapKey(tester, 'onb-aadhaar-go');
    expect(find.text('Wrong OTP'), findsOneWidget);
    expect(find.byKey(const ValueKey('onb-aadhaar-otp')), findsNothing); // send a fresh OTP
    await tapKey(tester, 'onb-aadhaar-go');
    await tester.enterText(find.byKey(const ValueKey('onb-aadhaar-otp')), '123456');
    await tapKey(tester, 'onb-aadhaar-go');
    expect(api.calls.where((c) => c == 'aadhaar start'), hasLength(2));
    expect(find.byKey(const ValueKey('onb-aadhaar')), findsNothing); // sheet closed
    expect(find.textContaining('XXXX XXXX 0123'), findsOneWidget);
  });

  testWidgets('B2: rejected riders see why and can fix it; Telugu', (tester) async {
    await pumpRider(tester, locale: 'te', make: (c) => FakeRiderApi(c, status: RiderStatus.rejected, statusNote: 'లైసెన్స్ నంబర్ సరిపోలలేదు'));
    expect(find.byKey(const ValueKey('rider-rejected')), findsOneWidget);
    expect(find.text('దయచేసి మీ వివరాలు సరిచేసి మళ్లీ సమర్పించండి'), findsOneWidget);
    expect(find.text('కారణం: లైసెన్స్ నంబర్ సరిపోలలేదు'), findsOneWidget);
  });

  testWidgets('B2: a paused rider cannot go online and is pointed to support', (tester) async {
    await pumpRider(tester, make: (c) => FakeRiderApi(c, status: RiderStatus.suspended, statusNote: 'Three complaints this week.'));
    expect(find.byKey(const ValueKey('rider-suspended')), findsOneWidget);
    expect(find.textContaining('Three complaints this week.'), findsOneWidget);
    expect(find.byKey(const ValueKey('online-toggle')), findsNothing);
    expect(find.byKey(const ValueKey('suspended-support')), findsOneWidget);
  });

  testWidgets('home shows cash with you and the acceptance rate', (tester) async {
    await pumpRider(tester, make: (c) => FakeRiderApi(c, cashInHandPaise: 120000, acceptancePct: 82));
    expect(find.text('Cash with you: ₹1200. It comes off your next payout.'), findsOneWidget);
    expect(find.text('You accepted 82% of offers'), findsOneWidget);
  });

  testWidgets('B3 + B4: with a delivery in hand the rider cannot go offline or sign out', (tester) async {
    final (container, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, jobs: [testJob()]));
    await tapKey(tester, 'online-toggle');
    expect(find.text('Finish your delivery before going offline.'), findsOneWidget);
    expect(api.calls.where((c) => c.startsWith('status')), isEmpty);
    expect(api.online, isTrue);

    await tester.tap(find.byKey(const ValueKey('sign-out')));
    await tester.pumpAndSettle();
    expect(find.text('Finish your delivery before signing out.'), findsOneWidget);
    expect(container.read(authControllerProvider), isA<AuthSignedIn>());
  });

  testWidgets('B4: signing out while online goes offline first', (tester) async {
    final (container, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true));
    await tester.tap(find.byKey(const ValueKey('sign-out')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('status false '));
    expect(api.online, isFalse);
    expect(container.read(authControllerProvider), isA<AuthSignedOut>());
  });

  test('B5: cash is read with commas, spaces and the rupee sign; anything else is refused', () {
    expect(cashPaise('1,200'), 120000);
    expect(cashPaise(' ₹ 1200.50 '), 120050);
    expect(cashPaise('156'), 15600);
    expect(cashPaise('abc'), isNull);
    expect(cashPaise(''), isNull);
    expect(cashPaise('12.345'), isNull);
  });

  testWidgets('B5: unreadable cash is not sent as ₹0; "1,560" is sent as ₹1560', (tester) async {
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, jobs: [testJob(state: DeliveryState.pickedUp, orderState: 'OUT_FOR_DELIVERY', codDuePaise: 156000)]));
    await tapKey(tester, 'job-j1');
    await tester.enterText(find.byKey(const ValueKey('delivery-otp')), '2468');
    await tester.enterText(find.byKey(const ValueKey('cash-collected')), 'abc');
    await tapKey(tester, 'mark-delivered');
    expect(find.text('Enter the cash you collected, like 1200.'), findsOneWidget);
    expect(api.calls.where((c) => c.startsWith('delivered')), isEmpty);

    await tester.enterText(find.byKey(const ValueKey('cash-collected')), '1,560');
    await tapKey(tester, 'mark-delivered');
    expect(api.calls.last, 'delivered 2468 156000');
  });

  testWidgets('B6: Arrived keeps a pickup code already typed; B8: arrived_store and offer_shown are tracked', (tester) async {
    final (container, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, offer: testOffer(id: 'o9'), jobs: [testJob()]));
    await tapKey(tester, 'job-j1');
    await tester.enterText(find.byKey(const ValueKey('pickup-code')), '4812');
    await tapKey(tester, 'arrived');
    expect(api.calls, contains('arrived'));
    expect(tester.widget<TextField>(find.descendant(of: find.byKey(const ValueKey('pickup-code')), matching: find.byType(TextField))).controller!.text, '4812');
    final events = (container.read(analyticsProvider) as DebugAnalytics).events.map((e) => e.$1);
    expect(events, containsAll(['offer_shown', 'arrived_store']));
  });

  testWidgets('B7: a job that fails to load can be retried', (tester) async {
    // Riverpod also retries on its own; here the network stays down until the rider taps Retry.
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, jobs: [testJob()])..jobFailures = 1000);
    await tapKey(tester, 'job-j1');
    expect(find.byKey(const ValueKey('job-retry')), findsOneWidget);
    api.jobFailures = 0;
    await tapKey(tester, 'job-retry');
    expect(find.byKey(const ValueKey('ready-state')), findsOneWidget);
    expect(api.jobFailures, 0);
  });

  testWidgets('B8: opening earnings is tracked', (tester) async {
    final (container, _) = await pumpRider(tester);
    await tester.tap(find.byTooltip('Earnings today'));
    await tester.pumpAndSettle();
    final events = (container.read(analyticsProvider) as DebugAnalytics).events.map((e) => e.$1);
    expect(events, contains('earnings_viewed'));
  });

  testWidgets('ADR-030: arrived at the customer starts a waiting timer; after 5 minutes it says what to do', (tester) async {
    final (_, api) = await pumpRider(tester, make: (c) => FakeRiderApi(c, online: true, jobs: [testJob(state: DeliveryState.pickedUp, orderState: 'OUT_FOR_DELIVERY')]));
    await tapKey(tester, 'job-j1');
    expect(find.byKey(const ValueKey('waiting-at-door')), findsNothing);
    await tapKey(tester, 'arrived-drop');
    expect(api.calls, contains('arrived-drop'));
    expect(find.text('Waiting at the door: 00:00'), findsOneWidget);
    expect(find.byKey(const ValueKey('waiting-long')), findsNothing);
    expect(find.byKey(const ValueKey('deliver-photo')), findsNothing); // a cash order: OTP only
  });

  testWidgets('ADR-030: waited over 5 minutes → call again or report; Telugu', (tester) async {
    await pumpRider(
      tester,
      locale: 'te',
      make: (c) => FakeRiderApi(c, online: true, jobs: [testJob(state: DeliveryState.pickedUp, orderState: 'OUT_FOR_DELIVERY', arrivedDropAt: testNow.subtract(const Duration(minutes: 6, seconds: 5)))]),
    );
    await tapKey(tester, 'job-j1');
    expect(find.text('తలుపు వద్ద వేచి ఉన్నారు: 06:05'), findsOneWidget);
    expect(find.byKey(const ValueKey('waiting-long')), findsOneWidget);
  });

  testWidgets('ADR-030: a prepaid order is left at the door with a photo (back camera), no OTP', (tester) async {
    final (container, api) = await pumpRider(
      tester,
      make: (c) => FakeRiderApi(c, online: true, jobs: [testJob(state: DeliveryState.pickedUp, orderState: 'OUT_FOR_DELIVERY', codDuePaise: 0, photoProofAllowed: true)]),
    );
    await tapKey(tester, 'job-j1');
    expect(find.byKey(const ValueKey('deliver-photo')), findsNothing); // arrive first
    await tapKey(tester, 'arrived-drop');
    await tapKey(tester, 'deliver-photo');
    expect(api.calls, containsAllInOrder(['photo delivery j1', 'delivered-photo ph1']));
    expect(find.byKey(const ValueKey('delivered-done')), findsOneWidget);
    final events = (container.read(analyticsProvider) as DebugAnalytics).events.map((e) => (e.$1, e.$2['verification']));
    expect(events, contains(('delivered', 'photo')));
    expect(events.map((e) => e.$1), contains('arrived_customer'));
  });
}
