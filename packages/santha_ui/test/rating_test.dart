import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_ui/santha_ui.dart';

import 'helpers.dart';

void main() {
  testWidgets('StarRow rounds to half stars and reads as one label', (tester) async {
    await pumpThemed(tester, const StarRow(value: 3.6, semanticLabel: 'Rated 3.6 out of 5'));
    expect(find.byIcon(Icons.star_rounded), findsNWidgets(3));
    expect(find.byIcon(Icons.star_half_rounded), findsOneWidget);
    expect(find.byIcon(Icons.star_outline_rounded), findsOneWidget);
    expect(find.bySemanticsLabel('Rated 3.6 out of 5'), findsOneWidget);
  });

  testWidgets('RatingBreakdown shows the average, count and a bar per star level, 5 first', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpThemed(
      tester,
      RatingBreakdown(
        avg: 4.25,
        count: 4,
        distribution: const [0, 0, 1, 1, 2],
        countLabel: '4 ratings',
        starsSemantics: 'Rated 4.3 out of 5',
        barSemantics: (s, n) => '$s stars: $n',
      ),
    );
    expect(find.text('4.3'), findsOneWidget);
    expect(find.text('4 ratings'), findsOneWidget);
    final bars = tester.widgetList<LinearProgressIndicator>(find.byType(LinearProgressIndicator)).map((b) => b.value).toList();
    expect(bars, [1.0, 0.5, 0.5, 0.0, 0.0]); // relative to the biggest level
    expect(find.bySemanticsLabel('5 stars: 2'), findsOneWidget);
    expect(find.bySemanticsLabel('1 stars: 0'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('RatingBreakdown without ratings shows the empty line, no bars', (tester) async {
    await pumpThemed(
      tester,
      RatingBreakdown(avg: null, count: 0, distribution: const [0, 0, 0, 0, 0], countLabel: '0 ratings', emptyLabel: 'No ratings yet', starsSemantics: '', barSemantics: (s, n) => ''),
    );
    expect(find.text('No ratings yet'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsNothing);
  });
}
