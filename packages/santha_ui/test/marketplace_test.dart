import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_ui/santha_ui.dart';

import 'helpers.dart';

void main() {
  testWidgets('StoreCard shows name, meta, ETA and self-delivers; taps through', (tester) async {
    var taps = 0;
    await pumpThemed(
      tester,
      StoreCard(
        name: 'Ramesh Stores',
        meta: 'Kirana · 600 m',
        eta: const EtaChip(minMinutes: 30, maxMinutes: 45),
        selfDeliversLabel: 'Self-delivers',
        onTap: () => taps++,
      ),
    );
    expect(find.text('Ramesh Stores'), findsOneWidget);
    expect(find.text('30–45 min'), findsOneWidget);
    expect(find.text('Self-delivers'), findsOneWidget);
    await tester.tap(find.text('Ramesh Stores'));
    expect(taps, 1);
  });

  testWidgets('closed StoreCard is dimmed and shows when it opens', (tester) async {
    await pumpThemed(tester, const StoreCard(name: 'Balaji', meta: 'Vegetables', closedLabel: 'Opens 7:00 am'));
    expect(find.text('Opens 7:00 am'), findsOneWidget);
    expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, lessThan(1));
  });

  testWidgets('AddButton: ADD pill, then a stepper with the quantity', (tester) async {
    var q = 0;
    await pumpThemed(
      tester,
      StatefulBuilder(
        builder: (_, set) => AddButton(quantity: q, addLabel: 'ADD', onAdd: () => set(() => q++), onRemove: () => set(() => q--)),
      ),
    );
    await tester.tap(find.text('ADD'));
    await tester.pump();
    expect(find.text('1'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();
    expect(find.text('2'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.remove));
    await tester.tap(find.byIcon(Icons.remove));
    await tester.pump();
    expect(find.text('ADD'), findsOneWidget);
  });

  testWidgets('ProductTile strikes the MRP; StickyCartBar reads as one button', (tester) async {
    await pumpThemed(
      tester,
      Column(children: [
        SizedBox(
          width: 160,
          height: 262,
          child: ProductTile(name: 'Toor Dal', price: '₹78', mrp: '₹92', add: AddButton(quantity: 0, addLabel: 'ADD', onAdd: () {}, onRemove: () {})),
        ),
        StickyCartBar(summary: '2 items · ₹156', action: 'View cart', onTap: () {}),
      ]),
      size: const Size(360, 380),
    );
    final mrp = tester.widget<Text>(find.text('₹92'));
    expect(mrp.style!.decoration, TextDecoration.lineThrough);
    expect(find.bySemanticsLabel('2 items · ₹156. View cart'), findsOneWidget);
  });

  testWidgets('FoodMarkIcon and SlotChip expose semantics', (tester) async {
    await pumpThemed(
      tester,
      Row(children: [
        const FoodMarkIcon(FoodMarkKind.nonVeg, semanticsLabel: 'Non-veg'),
        SlotChip(label: '12:30–1:30', selected: true, onTap: () {}),
        const SlotChip(label: '7:30–8:30', selected: false),
      ]),
    );
    expect(find.bySemanticsLabel('Non-veg'), findsOneWidget);
    expect(tester.getSemantics(find.text('12:30–1:30')), isSemantics(isButton: true, isSelected: true, isEnabled: true, hasTapAction: true));
  });
}
