import 'dart:convert';

import 'package:consumer/features/cart/cart_controller.dart';
import 'package:consumer/features/checkout/checkout_page.dart';
import 'package:consumer/features/location/location_controller.dart';
import 'package:consumer/features/orders/after_delivery.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import 'support/harness.dart';

/// Fixes from the 2026-11-05 mobile review (docs/reviews/2026-11-05-mobile-apps-review.md).
final _cart = jsonEncode({
  'merchantId': kiranaId,
  'merchantName': 'Ramesh Stores',
  'merchantNameTe': 'రమేష్ స్టోర్స్',
  'lines': [
    {'itemId': 'i1', 'variantId': '70000000-0000-4000-8000-201000000100', 'name': 'Annapoorna Chakki Atta', 'nameTe': 'అన్నపూర్ణ చక్కీ ఆటా', 'variantLabel': '1 kg', 'pricePaise': 6000, 'quantity': 2, 'maxPerOrder': null},
  ],
  'slot': null,
});

/// Browsing from a map pin about 2 km from both saved addresses.
final _pinnedAway = jsonEncode({
  'point': {'lat': 14.4700, 'lng': 79.9850},
  'source': 'gps',
  'serviceability': fixture('feed_stores')['serviceability'],
  'address': null,
});

Order _deliveredOrder({required String type, required DateTime at}) {
  final o = fixture('order_placed');
  return Order.fromJson({
    ...o,
    'state': 'DELIVERED',
    'merchant': {...(o['merchant'] as Map<String, dynamic>), 'type': type},
    'history': [...(o['history'] as List), {'to': 'DELIVERED', 'at': at.toIso8601String()}],
  });
}

void main() {
  testWidgets('C1: signing out clears the cart and the delivery location for the next person', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _cart});
    expect(h.container.read(cartControllerProvider).isEmpty, isFalse);
    await tester.tap(find.text('Account'));
    await settle(tester, 10);
    await tapVisible(tester, find.text('Sign out'));
    await settle(tester, 10);
    expect(h.container.read(cartControllerProvider).isEmpty, isTrue);
    expect(h.container.read(locationControllerProvider), isA<LocationUnset>());
    final kv = h.container.read(keyValueStoreProvider);
    expect(await kv.read('santha.location'), isNull);
    expect(jsonDecode((await kv.read('santha.cart'))!)['lines'], isEmpty);
  });

  testWidgets('C3: browsing from a map pin, checkout asks which address instead of billing the default one', (tester) async {
    final h = await pumpApp(tester, kv: {'santha.cart': _cart, 'santha.location': _pinnedAway});
    await settle(tester, 20);
    await tapVisible(tester, find.byKey(const ValueKey('cart-bar')));
    await tapVisible(tester, find.byKey(const ValueKey('to-checkout')));
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('pick-address-hint')), findsOneWidget);
    expect(find.byKey(const ValueKey('place-order')), findsNothing);
    expect(h.backend.requests, isNot(contains('POST /v1/cart/price')));

    await tapVisible(tester, find.byKey(const ValueKey('choose-address')));
    await tester.tap(find.textContaining('Sai Residency').last);
    await settle(tester, 20);
    expect(h.backend.requests, contains('POST /v1/cart/price'));
    expect((h.backend.bodies['POST /v1/cart/price'] as Map)['addressId'], '80000000-0000-4000-8000-000000000001');
    expect(find.byKey(const ValueKey('place-order')), findsOneWidget);
  });

  testWidgets('C2: adding an address from checkout comes back to checkout and bills that address', (tester) async {
    final h = await pumpApp(tester, kv: {'santha.cart': _cart, 'santha.location': _pinnedAway});
    await settle(tester, 20);
    await tapVisible(tester, find.byKey(const ValueKey('cart-bar')));
    await tapVisible(tester, find.byKey(const ValueKey('to-checkout')));
    await settle(tester, 20);
    await tapVisible(tester, find.byKey(const ValueKey('add-address')));
    await settle(tester, 20);
    expect(find.text('Continue without saving'), findsNothing); // checkout needs a saved address
    await tester.enterText(find.byKey(const ValueKey('address-line')), '7-1, Gandhi Nagar');
    await tapVisible(tester, find.text('Save and continue'));
    await settle(tester, 30);
    expect(find.text('Checkout'), findsOneWidget); // back on checkout, not Home
    expect((h.backend.bodies['POST /v1/cart/price'] as Map)['addressId'], '80000000-0000-4000-8000-000000000099');
    expect(find.byKey(const ValueKey('place-order')), findsOneWidget);
  });

  testWidgets('C4: deleting the address you deliver to keeps the spot on the map, without the address', (tester) async {
    final h = await pumpAtHome(tester);
    expect(h.container.read(deliveryPointProvider)!.address?.id, '80000000-0000-4000-8000-000000000001');
    await tester.tap(find.text('Account'));
    await settle(tester, 10);
    await tapVisible(tester, find.byType(PopupMenuButton<String>).first);
    await tester.tap(find.text('Delete address').last);
    await settle(tester, 10);
    expect(h.backend.requests, contains('DELETE /v1/me/addresses/80000000-0000-4000-8000-000000000001'));
    final loc = h.container.read(deliveryPointProvider)!;
    expect(loc.address, isNull);
    expect(loc.point.lat, 14.4535);
  });

  testWidgets('C7: the cart shows Telugu names in Telugu', (tester) async {
    await pumpAtHome(tester, locale: 'te', kv: {'santha.cart': _cart});
    await tapVisible(tester, find.byKey(const ValueKey('cart-bar')));
    expect(find.text('అన్నపూర్ణ చక్కీ ఆటా'), findsOneWidget);
    expect(find.textContaining('రమేష్ స్టోర్స్'), findsOneWidget);
  });

  test('C3: a saved address counts as "the same place" only within 200 m', () {
    final list = (fixture('address_list')['items'] as List).map((a) => Address.fromJson(a as Map<String, dynamic>)).toList();
    expect(nearestSavedAddress(list, const LatLng(14.4536, 79.9961))?.label, AddressLabel.home);
    expect(nearestSavedAddress(list, const LatLng(14.4700, 79.9850)), isNull);
    expect(nearestSavedAddress(list, null), isNull);
    expect(metresBetween(const LatLng(14.4535, 79.996), const LatLng(14.4535, 79.974)), closeTo(2370, 30));
  });

  test('C6: the report-a-problem window matches the server (kitchen 2 h, fashion 48 h, others 24 h)', () {
    final at = DateTime.utc(2026, 11, 5, 10);
    expect(canReportIssue(_deliveredOrder(type: 'home_kitchen', at: at), now: at.add(const Duration(minutes: 119))), isTrue);
    expect(canReportIssue(_deliveredOrder(type: 'home_kitchen', at: at), now: at.add(const Duration(minutes: 121))), isFalse);
    expect(canReportIssue(_deliveredOrder(type: 'retail', at: at), now: at.add(const Duration(hours: 23))), isTrue);
    expect(canReportIssue(_deliveredOrder(type: 'retail', at: at), now: at.add(const Duration(hours: 25))), isFalse);
    expect(canReportIssue(_deliveredOrder(type: 'fashion', at: at), now: at.add(const Duration(hours: 47))), isTrue);
  });
}
