import 'dart:convert';

import 'package:consumer/data/format.dart';
import 'package:consumer/features/cart/cart_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

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

  testWidgets('ADR-022: beyond the store radius the bill shows the extra delivery charge line', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    h.backend.extraFees = [
      {'code': 'beyond_radius', 'amountPaise': 3000, 'waivedPaise': 0},
    ];
    await openCheckout(tester);
    expect(find.text('Extra delivery charge (far from the store)'), findsOneWidget);
    expect(find.text('₹30'), findsOneWidget);
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

  testWidgets('M5: a placed order can be cancelled before the store accepts; the refund shows', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await openCheckout(tester);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 10);
    await tester.tap(find.byKey(const ValueKey('mock-pay')));
    await settle(tester, 20);
    expect(find.text('You can cancel until the store accepts.'), findsOneWidget);
    await tapVisible(tester, find.byKey(const ValueKey('cancel-placed-order')));
    await settle(tester, 10);
    await tester.tap(find.byKey(const ValueKey('cancel-ordered_by_mistake')));
    await settle(tester, 20);
    expect(h.backend.cancelReason, 'ordered_by_mistake');
    expect(find.byKey(const ValueKey('cancel-placed-order')), findsNothing);
    expect(find.byKey(const ValueKey('refunded')), findsOneWidget);
    expect(h.events, contains('order_cancelled'));
  });

  testWidgets('M5: a realtime order.updated refreshes the order; substituted lines are explained', (tester) async {
    final realtime = FakeRealtime();
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart}, realtime: realtime);
    await openCheckout(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    final o = fixture('order_placed');
    final lines = [
      for (final (i, l) in (o['lines'] as List).cast<Map<String, dynamic>>().indexed)
        i == 0 ? {...l, 'status': 'substituted', 'substituteName': 'Aashirvaad Atta', 'substituteVariantLabel': '1 kg', 'refundPaise': 1200} : l,
    ];
    h.backend.orderPatch = {'state': 'PREPARING', 'lines': lines, 'refundedPaise': 1200};
    realtime.emit('order.updated', {'orderId': o['id'], 'state': 'PREPARING'});
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('cancel-placed-order')), findsNothing);
    expect(find.text('Replaced with Aashirvaad Atta (1 kg)'), findsOneWidget);
    expect(find.byKey(const ValueKey('refunded')), findsOneWidget);
  });

  testWidgets('M5: WhatsApp order updates are off until the customer turns them on', (tester) async {
    final h = await pumpAtHome(tester);
    await tester.tap(find.text('Account'));
    await settle(tester, 10);
    final tile = find.byKey(const ValueKey('whatsapp-updates'));
    expect(tester.widget<SwitchListTile>(tile).value, isFalse);
    await tester.tap(tile);
    await settle(tester, 10);
    expect(h.backend.whatsapp, isTrue);
    expect(tester.widget<SwitchListTile>(tile).value, isTrue);
    expect(h.events, contains('whatsapp_opt_in_changed'));
  });

  testWidgets('M6: tracking shows the rider, OTP and ETA; live fixes move the ETA; the call is masked', (tester) async {
    final realtime = FakeRealtime();
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart}, realtime: realtime);
    await openCheckout(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    final o = fixture('order_placed');
    final eta = DateTime.now().add(const Duration(minutes: 12)).toUtc();
    h.backend.tracking = {
      ...fixture('tracking_picked_up'),
      'orderId': o['id'],
      'promisedAt': DateTime.now().add(const Duration(minutes: 20)).toUtc().toIso8601String(),
      'etaAt': eta.toIso8601String(),
    };
    h.backend.orderPatch = {'state': 'OUT_FOR_DELIVERY'};
    realtime.emit('order.updated', {'orderId': o['id'], 'state': 'OUT_FOR_DELIVERY'});
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('tracking')), findsOneWidget);
    expect(find.text('Demo Rider 2 · Santha rider'), findsOneWidget);
    // ADR-030: the rider marked "arrived at the customer".
    expect(find.text('Your delivery partner is at your door. Keep your OTP ready.'), findsOneWidget);
    final otp = (h.backend.tracking!['deliveryOtp'] as String).split('').join(' ');
    expect(find.text('Delivery OTP $otp'), findsOneWidget);
    expect(find.textContaining('On time · promised by'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('eta'))).data, anyOf('Arriving in 11 min', 'Arriving in 12 min'));

    realtime.emit('order.location', {'orderId': o['id'], 'lat': 14.455, 'lng': 79.993, 'etaAt': DateTime.now().add(const Duration(minutes: 30)).toUtc().toIso8601String()});
    await settle(tester, 4);
    expect(find.textContaining('Running late'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('eta'))).data, anyOf('Arriving in 29 min', 'Arriving in 30 min'));

    await tapVisible(tester, find.byKey(const ValueKey('call-courier')));
    expect(dialled.last, h.backend.tracking!['courier']['callNumber']);
  });

  testWidgets('ADR-030: a no-contact delivery shows the door photo on the order', (tester) async {
    final realtime = FakeRealtime();
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart}, realtime: realtime);
    await openCheckout(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    final o = fixture('order_placed');
    h.backend.tracking = {...fixture('tracking_picked_up'), 'orderId': o['id'], 'state': 'delivered', 'proofPhotoUrl': '/v1/dev/private?key=private%2Friders%2Fx.webp&exp=1&sig=ab'};
    h.backend.orderPatch = {'state': 'DELIVERED'};
    realtime.emit('order.updated', {'orderId': o['id'], 'state': 'DELIVERED'});
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('door-photo')), findsOneWidget);
    expect(find.text('Left at your door. This is the photo your delivery partner took.'), findsOneWidget);
    final img = tester.widget<Image>(find.descendant(of: find.byKey(const ValueKey('door-photo')), matching: find.byType(Image)));
    expect((img.image as NetworkImage).url, startsWith('http://api.test/v1/dev/private?')); // resolved against the API
  });

  testWidgets("ADR-026: couldn't deliver — the order explains it and the courier can still be called", (tester) async {
    final realtime = FakeRealtime();
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart}, realtime: realtime);
    await openCheckout(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    final o = fixture('order_placed');
    h.backend.tracking = {...fixture('tracking_picked_up'), 'orderId': o['id'], 'state': 'failed'};
    h.backend.orderPatch = {'state': 'FAILED_DELIVERY'};
    realtime.emit('order.updated', {'orderId': o['id'], 'state': 'FAILED_DELIVERY'});
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('delivery-failed')), findsOneWidget);
    expect(find.text('Delivery attempt failed'), findsOneWidget);
    expect(find.byKey(const ValueKey('eta')), findsNothing); // no promise while it waits
    await tapVisible(tester, find.byKey(const ValueKey('call-courier')));
    expect(dialled.last, h.backend.tracking!['courier']['callNumber']);
  });

  testWidgets('M6: no courier after the fallback ladder: the customer can cancel for a full refund', (tester) async {
    final realtime = FakeRealtime();
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart}, realtime: realtime);
    await openCheckout(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    final o = fixture('order_placed');
    h.backend.tracking = {
      ...fixture('tracking_picked_up'),
      'orderId': o['id'],
      'state': 'searching',
      'courier': null,
      'deliveryOtp': null,
      'courierLocation': null,
      'fallbackStage': 'customer_notified',
      'canCancelNoCourier': true,
    };
    h.backend.orderPatch = {'state': 'PREPARING'};
    realtime.emit('order.updated', {'orderId': o['id'], 'state': 'PREPARING'});
    await settle(tester, 20);
    expect(find.textContaining('taking longer than usual'), findsOneWidget);
    await tapVisible(tester, find.byKey(const ValueKey('cancel-no-courier')));
    await settle(tester, 20);
    expect(h.backend.cancelledNoCourier, isTrue);
    expect(h.events, contains('order_cancelled'));
    expect(find.byKey(const ValueKey('tracking')), findsNothing);
  });

  testWidgets('M7: after delivery — rate once, report a missing item and see the wallet refund at once', (tester) async {
    final realtime = FakeRealtime();
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart}, realtime: realtime);
    await openCheckout(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    final o = fixture('order_placed');
    h.backend.orderPatch = {'state': 'DELIVERED'};
    realtime.emit('order.updated', {'orderId': o['id'], 'state': 'DELIVERED'});
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('after-delivery')), findsOneWidget);

    expect(find.byKey(const ValueKey('rating-comment')), findsNothing); // the text box appears after the stars
    await tapVisible(tester, find.byKey(const ValueKey('stars-store-5')));
    await settle(tester, 4);
    await tester.enterText(find.byKey(const ValueKey('rating-comment')), '  Fresh atta, quick delivery  ');
    await tapVisible(tester, find.byKey(const ValueKey('send-rating')));
    await settle(tester, 10);
    expect(h.backend.rating!['storeStars'], 5);
    expect(h.backend.rating!['comment'], 'Fresh atta, quick delivery');
    expect(h.events, contains('rating_submitted'));
    // Rated: the stars are gone for good and the rating is shown instead.
    expect(find.byKey(const ValueKey('stars-store')), findsNothing);
    expect(find.byKey(const ValueKey('your-rating')), findsOneWidget);
    expect(find.text('“Fresh atta, quick delivery”'), findsOneWidget);

    await tapVisible(tester, find.byKey(const ValueKey('report-problem')));
    await settle(tester, 10);
    expect(find.text('What went wrong?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('type-missing_item')));
    await settle(tester, 4);
    final line = (o['lines'] as List).cast<Map<String, dynamic>>().first;
    await tester.tap(find.byKey(ValueKey('line-${line['variantId']}')));
    await settle(tester, 4);
    await tester.tap(find.byKey(const ValueKey('submit-issue')));
    await settle(tester, 20);
    expect(h.backend.issues.single['type'], 'missing_item');
    expect(find.byKey(const ValueKey('issue-missing_item')), findsOneWidget);
    expect(find.textContaining('is back in your Santha wallet'), findsOneWidget);
    expect(h.events, contains('issue_reported'));
  });

  testWidgets('ADR-028: support chat from the order page (about that order) and from Account', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await openCheckout(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    final o = fixture('order_placed');

    await tapVisible(tester, find.byKey(const ValueKey('order-get-help')));
    await settle(tester, 10);
    expect(find.text('Order #${o['code']}'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('support-first-message')), 'How long will it take?');
    await settle(tester, 4);
    await tester.tap(find.byKey(const ValueKey('support-start'))); // "Order is late" is preselected
    await settle(tester, 20);
    expect((h.backend.bodies['POST /v1/support/threads'] as Map), {'topic': 'order_late', 'body': 'How long will it take?', 'orderId': o['id']});
    expect(find.text('How long will it take?'), findsOneWidget);
    expect(h.events, contains('support_thread_opened'));
    await tester.pageBack();
    await settle(tester, 10);

    await tester.tap(find.byKey(const ValueKey('close-order')));
    await settle(tester, 10);
    await tester.tap(find.text('Account'));
    await settle(tester, 10);
    await tapVisible(tester, find.byKey(const ValueKey('open-support')));
    await settle(tester, 10);
    expect(find.text('Help & support'), findsOneWidget);
    expect(find.byKey(const ValueKey('support-thread-th1')), findsOneWidget);
  });

  testWidgets('M7: the wallet page lists refund credits', (tester) async {
    await pumpAtHome(tester);
    await tester.tap(find.text('Account'));
    await settle(tester, 10);
    await tester.tap(find.byKey(const ValueKey('wallet')));
    await settle(tester, 10);
    expect(find.byKey(const ValueKey('wallet-balance')), findsOneWidget);
    expect(find.textContaining('Balance ₹'), findsOneWidget);
  });

  testWidgets('ADR-032: a tip is added to the bill and the total, and sent with the order', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await openCheckout(tester);
    final total = tester.widget<Text>(find.byKey(const ValueKey('bill-total'))).data!;
    expect(find.text('Tip your delivery partner'), findsOneWidget);
    await tapVisible(tester, find.byKey(const ValueKey('tip-2000')));
    expect(find.text('Tip for your delivery partner'), findsOneWidget);
    final withTip = tester.widget<Text>(find.byKey(const ValueKey('bill-total'))).data!;
    int paise(String s) => (double.parse(s.replaceAll(RegExp(r'[^0-9.]'), '')) * 100).round();
    expect(paise(withTip) - paise(total), 2000);
    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    expect(tester.widget<SanthaButton>(find.byKey(const ValueKey('place-order'))).label, contains(withTip));
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    expect(h.backend.lastOrderBody?['tipPaise'], 2000);
    expect(h.events, contains('tip_selected'));
  });

  testWidgets('ADR-036: leave at the door is offered for prepaid orders, off by default, and sent with the order', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart});
    await openCheckout(tester);
    final sw = find.byKey(const ValueKey('leave-at-door'));
    await tester.scrollUntilVisible(sw, 300, scrollable: find.byType(Scrollable).first);
    expect(tester.widget<SwitchListTile>(sw).value, false);
    expect(find.text('Leave at my door'), findsOneWidget);
    await tester.tap(sw);
    await settle(tester, 4);
    expect(tester.widget<SwitchListTile>(sw).value, true);
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    expect(h.backend.lastOrderBody?['leaveAtDoor'], true);
  });

  testWidgets('ADR-036: the choice saved on the address is the default; cash orders do not offer it', (tester) async {
    final h = await pumpAtHome(tester, kv: {'santha.cart': _retailCart}, prepare: (b) => b.savedLeaveAtDoor = true);
    await openCheckout(tester);
    final sw = find.byKey(const ValueKey('leave-at-door'));
    await tester.scrollUntilVisible(sw, 300, scrollable: find.byType(Scrollable).first);
    expect(tester.widget<SwitchListTile>(sw).value, true); // from the saved address

    await tester.ensureVisible(find.byKey(const ValueKey('pay-cod')));
    await tester.tap(find.byKey(const ValueKey('pay-cod')));
    await settle(tester, 4);
    expect(sw, findsNothing); // cash is collected at the door
    await tapVisible(tester, find.byKey(const ValueKey('place-order')));
    await settle(tester, 20);
    expect(h.backend.lastOrderBody?.containsKey('leaveAtDoor'), false);
  });
}
