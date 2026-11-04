import 'package:flutter/material.dart';

import '../tokens.dart';

/// Read-only stars (whole and half) in Market Marigold.
class StarRow extends StatelessWidget {
  const StarRow({super.key, required this.value, this.size = 16, this.semanticLabel});

  /// 0…5; rounded to the nearest half star.
  final double value;
  final double size;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final halves = (value.clamp(0, 5) * 2).round();
    return Semantics(
      label: semanticLabel,
      excludeSemantics: true,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        for (var i = 1; i <= 5; i++)
          Icon(
            halves >= i * 2 ? Icons.star_rounded : (halves == i * 2 - 1 ? Icons.star_half_rounded : Icons.star_outline_rounded),
            size: size,
            color: SanthaColors.marigold,
          ),
      ]),
    );
  }
}

/// Store rating summary: the average, how many ratings, and one bar per star level (5 at the top).
/// Strings come from the app (en/te), like every santha_ui component.
class RatingBreakdown extends StatelessWidget {
  const RatingBreakdown({
    super.key,
    required this.avg,
    required this.count,
    required this.distribution,
    required this.countLabel,
    required this.starsSemantics,
    required this.barSemantics,
    this.emptyLabel,
  });

  final double? avg;
  final int count;

  /// Counts for 1…5 stars (index 0 is 1 star).
  final List<int> distribution;

  /// e.g. "12 ratings".
  final String countLabel;

  /// e.g. "Rated 4.2 out of 5".
  final String starsSemantics;

  /// e.g. (5, 8) → "5 stars: 8 ratings".
  final String Function(int stars, int n) barSemantics;

  /// Shown instead of the bars when there are no ratings yet.
  final String? emptyLabel;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    if (count == 0 || avg == null) {
      return Text(emptyLabel ?? countLabel, style: text.bodyMedium?.copyWith(color: SanthaColors.slate));
    }
    final most = distribution.fold<int>(0, (a, b) => b > a ? b : a);
    return Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
      Column(mainAxisSize: MainAxisSize.min, children: [
        Text(avg!.toStringAsFixed(1), style: text.displaySmall?.copyWith(fontWeight: FontWeight.w700, color: SanthaColors.ink)),
        StarRow(value: avg!, semanticLabel: starsSemantics),
        const SizedBox(height: SanthaSpacing.s1),
        Text(countLabel, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
      ]),
      const SizedBox(width: SanthaSpacing.s5),
      Expanded(
        child: Column(children: [
          for (var stars = 5; stars >= 1; stars--)
            Semantics(
              label: barSemantics(stars, distribution[stars - 1]),
              excludeSemantics: true,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [
                  SizedBox(width: 14, child: Text('$stars', style: text.bodySmall?.copyWith(color: SanthaColors.slate))),
                  const Icon(Icons.star_rounded, size: 12, color: SanthaColors.marigold),
                  const SizedBox(width: SanthaSpacing.s2),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(SanthaRadius.pill),
                      child: LinearProgressIndicator(
                        minHeight: 8,
                        value: most == 0 ? 0 : distribution[stars - 1] / most,
                        color: SanthaColors.marigold,
                        backgroundColor: SanthaColors.indigo100,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 32,
                    child: Text('${distribution[stars - 1]}', textAlign: TextAlign.end, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                  ),
                ]),
              ),
            ),
        ]),
      ),
    ]);
  }
}
