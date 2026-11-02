@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_ui/santha_ui.dart';

import 'helpers.dart';

/// Golden images live in test/goldens/. Regenerate on Linux with `melos run golden:update`
/// and review the PNGs against design/mockups before committing.
///
/// Goldens are compared on Linux only (CI and `golden:update` run there): font anti-aliasing differs
/// on Windows/macOS by a few percent, which would fail every local run there for no real reason.
final skipOffLinux = !Platform.isLinux;

void main() {
  setUpAll(loadSanthaFonts);

  testWidgets('SanthaButton variants', (tester) async {
    await pumpThemed(
      tester,
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SanthaButton(label: 'Continue', onPressed: () {}),
          const SizedBox(height: SanthaSpacing.s3),
          SanthaButton(label: 'Accept 0:17', variant: SanthaButtonVariant.accent, onPressed: () {}),
          const SizedBox(height: SanthaSpacing.s3),
          SanthaButton(label: 'Item unavailable', variant: SanthaButtonVariant.outline, onPressed: () {}),
          const SizedBox(height: SanthaSpacing.s3),
          const SanthaButton(label: 'Disabled', onPressed: null),
        ],
      ),
      size: const Size(360, 300),
    );
    await expectLater(find.byKey(const ValueKey('golden')), matchesGoldenFile('goldens/santha_button.png'));
  }, skip: skipOffLinux);

  testWidgets('EtaChip and SelfDeliversBadge (en + te)', (tester) async {
    await pumpThemed(
      tester,
      const Wrap(
        spacing: SanthaSpacing.s2,
        runSpacing: SanthaSpacing.s2,
        children: [
          EtaChip(minMinutes: 30, maxMinutes: 45),
          EtaChip(minMinutes: 28, maxMinutes: 28),
          SelfDeliversBadge(),
          EtaChip(minMinutes: 30, maxMinutes: 45, unit: 'నిమి'),
          SelfDeliversBadge(label: 'స్వయంగా డెలివరీ'),
        ],
      ),
      size: const Size(360, 120),
    );
    await expectLater(find.byKey(const ValueKey('golden')), matchesGoldenFile('goldens/chips_badges.png'));
  }, skip: skipOffLinux);

  testWidgets('Marketplace: store card, product tile, slots, cart bar', (tester) async {
    await pumpThemed(
      tester,
      Column(mainAxisSize: MainAxisSize.min, children: [
        const StoreCard(
          name: 'Ramesh Stores',
          meta: 'Grocery · 1.1 km',
          eta: EtaChip(minMinutes: 30, maxMinutes: 45),
          selfDeliversLabel: 'Self-delivers',
        ),
        const SizedBox(height: SanthaSpacing.s3),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            width: 104,
            height: 262,
            child: ProductTile(
              name: 'Toor Dal 1 kg',
              price: '₹168',
              mrp: '₹180',
              foodMark: const FoodMarkIcon(FoodMarkKind.veg, semanticsLabel: 'Veg'),
              add: AddButton(quantity: 0, addLabel: 'ADD', onAdd: () {}, onRemove: () {}),
            ),
          ),
          const SizedBox(width: SanthaSpacing.s3),
          Expanded(
            child: Wrap(spacing: SanthaSpacing.s2, runSpacing: SanthaSpacing.s2, children: [
              SlotChip(label: '12:30–1:00', sublabel: 'Order by 11:00 am', selected: true, onTap: () {}),
              SlotChip(label: '7:30–8:00 pm', selected: false, onTap: () {}),
              const SlotChip(label: '1:00–1:30', sublabel: 'Full', selected: false),
              const TrustBadge(label: 'FSSAI OK', icon: Icons.verified_outlined),
              const FoodMarkIcon(FoodMarkKind.nonVeg, semanticsLabel: 'Non-veg'),
              AddButton(quantity: 2, addLabel: 'ADD', onAdd: () {}, onRemove: () {}),
            ]),
          ),
        ]),
        const SizedBox(height: SanthaSpacing.s3),
        StickyCartBar(summary: '3 items · ₹575', action: 'View cart', onTap: () {}),
      ]),
      size: const Size(360, 520),
    );
    await expectLater(find.byKey(const ValueKey('golden')), matchesGoldenFile('goldens/marketplace.png'));
  }, skip: skipOffLinux);
}
