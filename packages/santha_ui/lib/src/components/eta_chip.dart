import 'package:flutter/material.dart';

import '../tokens.dart';

/// Computed delivery-time range, e.g. "30–45 min". Leaf text on the ETA tint, pill shape.
/// Never pass a single promised number — Santha always shows the computed range.
class EtaChip extends StatelessWidget {
  const EtaChip({
    super.key,
    required this.minMinutes,
    required this.maxMinutes,
    this.unit = 'min',
    this.semanticsLabel,
  }) : assert(minMinutes > 0 && maxMinutes >= minMinutes);

  final int minMinutes;
  final int maxMinutes;

  /// Localised unit ("min" / "నిమి").
  final String unit;

  /// Localised screen-reader text, e.g. "Arrives in 30 to 45 minutes".
  final String? semanticsLabel;

  String get text => minMinutes == maxMinutes ? '$minMinutes $unit' : '$minMinutes–$maxMinutes $unit';

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: SanthaColors.leaf,
          fontWeight: FontWeight.w500,
        );
    return Semantics(
      label: semanticsLabel ?? text,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: const ShapeDecoration(color: SanthaColors.etaBg, shape: StadiumBorder()),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s2, vertical: 3),
          child: Text(text, style: style, maxLines: 1),
        ),
      ),
    );
  }
}
