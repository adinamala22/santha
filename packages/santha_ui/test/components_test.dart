import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_ui/santha_ui.dart';

import 'helpers.dart';

void main() {
  group('SanthaButton', () {
    testWidgets('primary is indigo with a white label and ≥44 px touch target', (tester) async {
      var taps = 0;
      await pumpThemed(tester, SanthaButton(label: 'Continue', onPressed: () => taps++));
      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.style!.backgroundColor!.resolve({}), SanthaColors.indigo);
      expect(button.style!.foregroundColor!.resolve({}), SanthaColors.white);
      expect(tester.getSize(find.byType(FilledButton)).height, greaterThanOrEqualTo(44));
      await tester.tap(find.text('Continue'));
      expect(taps, 1);
    });

    testWidgets('accent is marigold with an indigo label', (tester) async {
      await pumpThemed(tester, SanthaButton(label: 'Accept', variant: SanthaButtonVariant.accent, onPressed: () {}));
      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.style!.backgroundColor!.resolve({}), SanthaColors.marigold);
      expect(button.style!.foregroundColor!.resolve({}), SanthaColors.indigo);
    });

    testWidgets('loading blocks taps, shows a spinner and keeps the label for screen readers', (tester) async {
      var taps = 0;
      await pumpThemed(tester, SanthaButton(label: 'Verify', loading: true, onPressed: () => taps++));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.bySemanticsLabel('Verify'), findsOneWidget);
      await tester.tap(find.byType(FilledButton));
      expect(taps, 0);
    });
  });

  group('EtaChip', () {
    testWidgets('shows the computed range in leaf on the ETA tint', (tester) async {
      await pumpThemed(tester, const EtaChip(minMinutes: 30, maxMinutes: 45));
      expect(find.text('30–45 min'), findsOneWidget);
      final text = tester.widget<Text>(find.text('30–45 min'));
      expect(text.style!.color, SanthaColors.leaf);
      final box = tester.widget<DecoratedBox>(find.descendant(of: find.byType(EtaChip), matching: find.byType(DecoratedBox)));
      expect((box.decoration as ShapeDecoration).color, SanthaColors.etaBg);
    });

    testWidgets('supports localised units and semantics', (tester) async {
      await pumpThemed(
        tester,
        const EtaChip(minMinutes: 25, maxMinutes: 35, unit: 'నిమి', semanticsLabel: '25 నుండి 35 నిమిషాల్లో'),
        locale: const Locale('te'),
      );
      expect(find.text('25–35 నిమి'), findsOneWidget);
      expect(find.bySemanticsLabel('25 నుండి 35 నిమిషాల్లో'), findsOneWidget);
    });
  });

  group('SelfDeliversBadge', () {
    testWidgets('indigo on marigold 100', (tester) async {
      await pumpThemed(tester, const SelfDeliversBadge());
      expect(tester.widget<Text>(find.text('Self-delivers')).style!.color, SanthaColors.indigo);
      final box = tester.widget<DecoratedBox>(
        find.descendant(of: find.byType(SelfDeliversBadge), matching: find.byType(DecoratedBox)),
      );
      expect((box.decoration as ShapeDecoration).color, SanthaColors.marigold100);
    });
  });

  group('santhaTheme', () {
    test('uses Poppins for English and Noto Sans Telugu for Telugu, from the santha_ui package', () {
      expect(santhaTheme().textTheme.bodyMedium!.fontFamily, 'packages/santha_ui/Poppins');
      expect(santhaTheme(locale: const Locale('te')).textTheme.bodyMedium!.fontFamily, 'packages/santha_ui/NotoSansTelugu');
      expect(santhaTheme().colorScheme.primary, SanthaColors.indigo);
      expect(santhaTheme().colorScheme.secondary, SanthaColors.marigold);
    });
  });
}
