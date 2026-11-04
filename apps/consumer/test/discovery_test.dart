import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_ui/santha_ui.dart';

import 'support/harness.dart';

/// M3 acceptance (widget level): location → home → search → store / kitchen pages with the cart
/// bar; offline with cached pages and a stale indicator; analytics events.
final vertical = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).first;

void main() {
  testWidgets('first run: sign in → choose a saved address → home with stores', (tester) async {
    final h = await pumpApp(tester);
    expect(find.text('Where should we deliver?'), findsOneWidget);
    expect(find.textContaining('Sai Residency'), findsOneWidget); // saved addresses listed
    await tester.tap(find.textContaining('Sai Residency'));
    await settle(tester, 20);

    expect(find.text('Deliver to'), findsOneWidget);
    expect(find.text('Home · Dargamitta'), findsOneWidget);
    expect(find.text('Shop by category'), findsOneWidget);
    expect(find.text('Ramesh Stores'), findsOneWidget);
    expect(find.text('Self-delivers'), findsOneWidget);
    expect(h.events, containsAllInOrder(['app_open', 'location_set', 'serviceability_result', 'feed_viewed']));
  });

  testWidgets('outside the service area: says so and offers another address', (tester) async {
    final h = await pumpApp(tester, signIn: false);
    h.backend.serviceable = false;
    await pumpAppSignIn(tester);
    await tester.tap(find.textContaining('Sai Residency'));
    await settle(tester, 20);
    expect(find.byKey(const ValueKey('not-serviceable')), findsOneWidget);
    expect(find.text("We're not in your area yet"), findsOneWidget);
  });

  testWidgets('home tabs switch the feed: Home Kitchens shows the next slot', (tester) async {
    await pumpAtHome(tester);
    await tapVisible(tester, find.byKey(const ValueKey('tab-home_kitchens')));
    expect(find.text("Saraswathi's Kitchen"), findsOneWidget);
    expect(find.textContaining('Next slot'), findsOneWidget);
    expect(find.text('Shop by category'), findsNothing);
  });

  testWidgets('search: results grouped by store, Telugu hints, inline ADD updates the cart bar', (tester) async {
    final h = await pumpAtHome(tester);
    await tester.tap(find.byKey(const ValueKey('home-search')));
    await settle(tester);
    await tester.enterText(find.byKey(const ValueKey('search-field')), 'atta');
    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);

    expect(find.byKey(const ValueKey('group-$kiranaId')), findsOneWidget);
    expect(find.textContaining('Ramesh Stores ·'), findsOneWidget);
    expect(find.byKey(const ValueKey('hint-గోధుమ పిండి')), findsOneWidget);

    await tester.tap(find.text('ADD').first);
    await settle(tester);
    expect(find.text('1 item · ₹60'), findsOneWidget);
    expect(h.events, containsAll(['search_performed', 'add_to_cart']));
  });

  testWidgets('store page: trust row, categories, ADD updates the sticky cart bar', (tester) async {
    final h = await pumpAtHome(tester);
    await tapVisible(tester, find.text('Ramesh Stores'));

    expect(find.text('FSSAI OK'), findsOneWidget);
    expect(find.textContaining('Min order ₹99'), findsOneWidget);
    expect(find.byKey(const ValueKey('cart-bar')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('chip-staples')));
    await settle(tester);
    final atta = find.byKey(const ValueKey('item-40000000-0000-4000-8000-201000000001'));
    await tester.scrollUntilVisible(atta, 300, scrollable: vertical);
    await settle(tester, 4);
    expect(atta, findsOneWidget);
    await tester.tap(find.descendant(of: atta, matching: find.text('ADD')));
    await settle(tester);
    expect(find.text('1 item · ₹60'), findsOneWidget);
    await tester.tap(find.descendant(of: atta, matching: find.byIcon(Icons.add)));
    await settle(tester);
    expect(find.text('2 items · ₹120'), findsOneWidget);

    // product sheet: sizes with MRP, substitution info
    await tester.tap(find.descendant(of: atta, matching: find.textContaining('Annapoorna')));
    await settle(tester);
    expect(find.text('Choose a size'), findsOneWidget);
    expect(find.text('5 kg'), findsOneWidget);
    expect(find.textContaining('they will call you before replacing it'), findsOneWidget);
    expect(h.events, containsAll(['merchant_viewed', 'item_viewed', 'add_to_cart']));
  });

  testWidgets('home-kitchen page: slots with cut-offs, food marks, allergens; slot in the cart bar', (tester) async {
    await pumpAtHome(tester);
    await tapVisible(tester, find.byKey(const ValueKey('tab-home_kitchens')));
    await tapVisible(tester, find.text("Saraswathi's Kitchen"));

    expect(find.text('Hygiene declared'), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w is FoodMarkIcon && w.kind == FoodMarkKind.nonVeg && w.semanticsLabel == 'Non-veg'), findsWidgets);
    expect(find.textContaining('Order by'), findsWidgets); // slot cut-offs
    final pulusu = find.byKey(const ValueKey('item-40000000-0000-4000-8000-210000000001'));
    await tester.scrollUntilVisible(pulusu, 200, scrollable: vertical);
    await settle(tester, 4);
    await tester.tap(find.descendant(of: pulusu, matching: find.text('ADD')));
    await settle(tester);
    expect(find.textContaining('· Slot '), findsOneWidget);
    expect(find.textContaining('Checkout'), findsOneWidget);
    await tester.scrollUntilVisible(find.textContaining('Allergens:'), 300, scrollable: vertical);
    expect(find.textContaining('fish'), findsWidgets);
  });

  testWidgets('offline: a store page seen before opens from the cache with a stale banner', (tester) async {
    final h = await pumpAtHome(tester);
    await tapVisible(tester, find.text('Ramesh Stores'));
    expect(find.byKey(const ValueKey('stale-banner')), findsNothing);
    await tester.tap(find.byTooltip('Back'));
    await settle(tester);

    h.backend.offline = true;
    await tapVisible(tester, find.text('Ramesh Stores'));
    expect(find.byKey(const ValueKey('stale-banner')), findsOneWidget);
    expect(find.textContaining("You're offline"), findsOneWidget);
    expect(find.text('FSSAI OK'), findsOneWidget); // content still there
  });

  testWidgets('offline with nothing cached: error with retry', (tester) async {
    final h = await pumpAtHome(tester);
    h.backend.offline = true;
    await tapVisible(tester, find.byKey(const ValueKey('tab-home_kitchens')));
    expect(find.text('Try again'), findsOneWidget);
    h.backend.offline = false;
    await tester.tap(find.text('Try again'));
    await settle(tester);
    expect(find.text("Saraswathi's Kitchen"), findsOneWidget);
  });

  testWidgets('ratings: "4★ & above" keeps only stores rated 4 or more; none yet says so', (tester) async {
    final h = await pumpAtHome(tester);
    expect(find.text('Ramesh Stores'), findsOneWidget);
    // Unrated: the filter leaves nothing and explains why.
    await tapVisible(tester, find.byKey(const ValueKey('filter-top-rated')));
    await settle(tester, 6);
    expect(find.text('No stores rated 4★ or above here yet.'), findsOneWidget);
    expect(find.text('Ramesh Stores'), findsNothing);
    await tapVisible(tester, find.byKey(const ValueKey('filter-top-rated')));
    await settle(tester, 6);
    expect(find.text('Ramesh Stores'), findsOneWidget);

    h.backend.kiranaRating = (avg: 4.3, count: 12);
    await tapVisible(tester, find.byKey(const ValueKey('filter-top-rated')));
    await settle(tester, 6);
    expect(find.text('Ramesh Stores'), findsOneWidget);
    expect(find.textContaining('★ 4.3'), findsOneWidget);
    expect(h.analytics.events.where((e) => e.$1 == 'feed_viewed').last.$2['top_rated'], isTrue);
  });

  testWidgets('store page: rating opens the breakdown and published reviews with the store reply', (tester) async {
    final h = await pumpAtHome(tester);
    h.backend.kiranaRating = (avg: 4.0, count: 3);
    await tapVisible(tester, find.text('Ramesh Stores'));
    expect(find.text('★ 4.0 (3)'), findsOneWidget);
    final open = find.byKey(const ValueKey('open-reviews'));
    await tester.scrollUntilVisible(open, 300, scrollable: vertical);
    await settle(tester, 4);
    expect(find.text('4.0 · 3 ratings'), findsOneWidget);
    await tester.tap(open);
    await settle(tester, 10);
    expect(find.byKey(const ValueKey('store-reviews')), findsOneWidget);
    expect(find.text('Ratings & reviews'), findsWidgets);
    expect(find.text('3 ratings'), findsOneWidget);
    expect(find.text('Good, packing could be better'), findsOneWidget);
    expect(find.text('Reply from the store'), findsOneWidget);
    expect(find.text('Thank you! See you again.'), findsOneWidget);
    expect(h.backend.requests, contains('GET /v1/stores/$kiranaId/reviews'));
  });

  testWidgets('store page of an unrated store: "No ratings yet", no reviews link', (tester) async {
    await pumpAtHome(tester);
    await tapVisible(tester, find.text('Ramesh Stores'));
    final section = find.byKey(const ValueKey('ratings-section'));
    await tester.scrollUntilVisible(section, 300, scrollable: vertical);
    await settle(tester, 4);
    expect(find.descendant(of: section, matching: find.textContaining('No ratings yet')), findsOneWidget);
    expect(find.byKey(const ValueKey('open-reviews')), findsNothing);
  });

  testWidgets('store page says why it does not deliver here', (tester) async {
    final h = await pumpAtHome(tester);
    h.backend.kiranaPagePatch = {'deliversHere': false, 'notDeliveringReason': 'too_far', 'deliveryRadiusM': 3000};
    await tapVisible(tester, find.text('Ramesh Stores'));
    expect(find.text('This store delivers up to 3.0 km away, and your address is farther.'), findsOneWidget);
  });

  testWidgets('home in Telugu', (tester) async {
    await pumpAtHome(tester, locale: 'te');
    expect(find.text('వర్గం వారీగా కొనండి'), findsOneWidget);
    expect(find.text('4.0+'), findsOneWidget); // the rating filter
    await tester.scrollUntilVisible(find.text('రమేష్ స్టోర్స్'), 200, scrollable: vertical);
    expect(find.text('రమేష్ స్టోర్స్'), findsOneWidget);
    expect(find.text('స్వయంగా డెలివరీ'), findsOneWidget);
  });
}

/// Sign in on an already-pumped app (used when the backend must be configured first).
Future<void> pumpAppSignIn(WidgetTester tester) async {
  await tester.enterText(find.byKey(const ValueKey('phone')), '9000000001');
  await tester.tap(find.byType(FilledButton).first);
  await settle(tester, 2);
  await tester.enterText(find.byKey(const ValueKey('code')), '123456');
  await tester.tap(find.byType(FilledButton).first);
  await settle(tester);
  await tester.pump(const Duration(seconds: 31));
  await settle(tester);
}
