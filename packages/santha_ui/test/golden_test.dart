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
}
