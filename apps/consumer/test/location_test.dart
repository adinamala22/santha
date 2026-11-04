import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:consumer/data/providers.dart';
import 'package:consumer/features/location/location_controller.dart';
import 'package:santha_api/santha_api.dart';

import 'discovery_test.dart' show pumpAppSignIn;
import 'support/harness.dart';

/// Location accuracy and "not deliverable" explanations (ADR-019).
void main() {
  testWidgets('current location opens the pin at the GPS fix with its accuracy; confirming uses it', (tester) async {
    final gps = FakeLocator(const Located(LatLng(14.4530, 79.9950), accuracyM: 85));
    final h = await pumpApp(tester, locator: gps);
    await tester.tap(find.byKey(const ValueKey('use-gps')));
    await settle(tester, 20);
    expect(gps.calls, 1);
    // Not used straight away: the customer confirms on the map, told how accurate the fix is.
    expect(find.byKey(const ValueKey('gps-accuracy')), findsOneWidget);
    expect(find.textContaining('accurate to about 85 m'), findsOneWidget);
    expect(h.events, contains('gps_fix'));
    expect(h.events, isNot(contains('location_set')));

    // Locate me again: a better fix replaces it.
    gps.result = const Located(LatLng(14.4531, 79.9951), accuracyM: 12);
    await tester.tap(find.byKey(const ValueKey('locate-me')));
    await settle(tester, 10);
    expect(gps.calls, 2);
    expect(find.textContaining('accurate to about 12 m'), findsOneWidget);

    await tapVisible(tester, find.text('Continue without saving'));
    await settle(tester, 20);
    final loc = h.container.read(deliveryPointProvider)!;
    expect(loc.source, LocationSource.gps);
    expect(find.text('Shop by category'), findsOneWidget);
  });

  testWidgets('approximate-only permission says so; no fix explains and offers the map', (tester) async {
    final gps = FakeLocator(const Located(LatLng(14.45, 79.99), accuracyM: 1500, precise: false));
    await pumpApp(tester, locator: gps);
    await tester.tap(find.byKey(const ValueKey('use-gps')));
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('gps-approximate')), findsOneWidget);
    await tester.pageBack();
    await settle(tester, 10);

    gps.result = const LocationUnavailable();
    await tester.tap(find.byKey(const ValueKey('use-gps')));
    await settle(tester, 10);
    expect(find.text("We couldn't find your location. Pick your place on the map."), findsOneWidget);
  });

  testWidgets('not deliverable: names the nearest area we serve and how far it is', (tester) async {
    final h = await pumpApp(tester, signIn: false);
    h.backend.serviceable = false;
    await pumpAppSignIn(tester);
    await tester.tap(find.textContaining('Sai Residency'));
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('not-serviceable')), findsOneWidget);
    expect(find.text('The nearest area we deliver to is Magunta Layout, 3.5 km away.'), findsOneWidget);
  });
}
