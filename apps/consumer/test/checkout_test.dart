import 'dart:convert';

import 'package:consumer/data/format.dart';
import 'package:consumer/features/cart/cart_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

/// M4 (widget level): cart page → checkout (bill, coupon, payment method) → place order (COD or
/// online through the mock payment sheet) → order placed; Orders tab; wallet. Backend responses are
/// the ones captured from the fake service.
final _retailCart = jsonEncode({
  'merchantId': kiranaId,
  'merchantName': 'Ramesh Stores',
  'lines': [
    {'itemId': '40000000-0000-4000-8000-201000000001', 'variantId': '70000000-0000-4000-8000-201000000100', 'name': 'Annapoorna Chakki Atta', 'variantLabel': '1 kg', 'pricePaise': 6000, 'quantity': 2, 'maxPerOrder': null},
    {'itemId': '40000000-0000-4000-8000-201000000003', 'variantId': '70000000-0000-4000-8000-201000000300', 'name': 'Annapoorna Basmati Rice', 'variantLabel': '1 kg', 'pricePaise': 17700, 'quantity': 1, 'maxPerOrder': null},
  ],
  'slot': null,
});

final _kitchenCart = jsonEncode({
  'merchantId': kitchenId,
  'merchantName': "Saraswathi's Kitchen",
  'lines': [
    {'itemId': '40000000-0000-4000-8000-210000000002', 'variantId': '70000000-0000-4000-8000-210000000200', 'name': 'Veg Meals', 'variantLabel': '1 plate', 'pricePaise': 14000, 'quantity': 2, 'maxPerOrder': null},
  ],
  'slot': {'slotId': '60000000-0000-4000-8000-210000000003', 'date': '2026-11-03', 'start': '19:30'},
});

Future<void> openCheckout(WidgetTester tester) async {
  await tapVisible(tester, find.byKey(const ValueKey('cart-bar')));
  expect(find.text('Your cart'), findsOneWidget);
  await tapVisible(tester, find.byKey(const ValueKey('to-checkout')));
  await settle(tester, 20);
}

void main() {
  testWidgets('cart page: lines, "if unavailable" preference, item total, then checkout', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await tapVisible(tester, find.byKey(const ValueKey('cart-bar')));
    expect(find.text('From Ramesh Stores'), findsOneWidget);
    expect(find.text('Annapoorna Chakki Atta'), findsOneWidget);
    expect(find.text('₹297'), findsOneWidget); // 2 × ₹60 + ₹177
    await tester.tap(find.byKey(const ValueKey('sub-70000000-0000-4000-8000-201000000100')));
    await settle(tester, 4);
    await tester.tap(find.text('Send a similar item').last);
    await settle(tester, 4);
    expect(h.events, contains('cart_viewed'));
  });

  testWidgets('ACCEPTANCE: checkout shows the server bill; COD places the order and empties the cart', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await openCheckout(tester);
    final q = fixture('checkout_retail');
    expect(find.byKey(const ValueKey('bill')), findsOneWidget);
    expect(find.text(rupees(q['bill']['totalPaise'] as int)), findsOneWidget);
    expect(find.textContaining('TINY applied'), findsOneWidget);
    expect(find.text('FREE'), findsOneWidget); // delivery waived over ₹199
    // The app synced its cart (with the substitution preference) before pricing
    final put = h.backend.bodies['PUT /v1/cart'] as Map;
    expect(put['merchantId'], kiranaId);
    expect((put['lines'] as List).first, containsPair('substitution', 'call_me'));

    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);

    expect(find.byKey(const ValueKey('order-placed-banner')), findsOneWidget);
    expect(find.text('Order placed!'), findsOneWidget);
    final order = h.backend.bodies['POST /v1/orders'] as Map;
    expect(order['paymentMethod'], 'cod');
    expect(order['quoteId'], q['quoteId']);
    expect(h.backend.requests.where((r) => r == 'POST /v1/orders'), hasLength(1));
    expect(h.events, containsAllInOrder(['checkout_started', 'order_placed']));
    expect(h.container.read(cartControllerProvider).isEmpty, isTrue);
  });

  testWidgets('online payment: mock payment sheet → paid → order placed', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await openCheckout(tester);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 10);
    expect(find.text('Test payment'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('mock-pay')));
    await settle(tester, 20);
    expect(find.text('Order placed!'), findsOneWidget);
    expect(h.backend.requests, contains(startsWith('POST /v1/dev/payments/')));
    expect(h.events, containsAllInOrder(['payment_initiated', 'payment_succeeded', 'order_placed']));
  });

  testWidgets('failed payment: try again or cancel the order', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await openCheckout(tester);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 10);
    await tester.tap(find.byKey(const ValueKey('mock-fail')));
    await settle(tester, 10);
    expect(find.text("Payment didn't go through"), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('cancel-order')));
    await settle(tester, 10);
    expect(h.backend.requests, contains(endsWith('/abandon-payment')));
    expect(h.events, contains('payment_failed'));
    expect(find.text('Checkout'), findsOneWidget); // still on checkout, cart kept
  });

  testWidgets('home kitchen: cash on delivery is not offered for cooked food', (tester) async {
    await pumpAtHome(tester, kv: {'santha.cart': _kitchenCart});
    await openCheckout(tester);
    expect(find.text('Delivery slot'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    expect(find.text('Not available for home-cooked food'), findsOneWidget);
    expect(find.textContaining('GST on food (5%)'), findsOneWidget);
  });

  testWidgets('Orders tab lists orders; account shows the wallet', (tester) async {
    await pumpAtHome(tester);
    await tester.tap(find.text('Orders').last);
    await settle(tester, 10);
    expect(find.text('Ramesh Stores'), findsOneWidget);
    expect(find.textContaining('Order SN'), findsOneWidget);
    await tester.tap(find.text('Account').last);
    await settle(tester, 10);
    expect(find.byKey(const ValueKey('wallet')), findsOneWidget);
  });
}
