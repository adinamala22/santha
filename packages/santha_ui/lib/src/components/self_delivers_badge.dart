import 'package:flutter/material.dart';

import '../tokens.dart';

/// Marks stores that deliver with their own staff (the hybrid-fulfilment differentiator).
/// Indigo text on Marigold 100, pill shape.
class SelfDeliversBadge extends StatelessWidget {
  const SelfDeliversBadge({super.key, this.label = 'Self-delivers', this.showIcon = true});

  /// Localised label ("Self-delivers" / "స్వయంగా డెలివరీ").
  final String label;
  final bool showIcon;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: SanthaColors.indigo,
          fontWeight: FontWeight.w500,
        );
    return Semantics(
      label: label,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: const ShapeDecoration(color: SanthaColors.marigold100, shape: StadiumBorder()),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s2, vertical: 3),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (showIcon) ...[
                const Icon(Icons.storefront_outlined, size: 12, color: SanthaColors.indigo),
                const SizedBox(width: SanthaSpacing.s1),
              ],
              Flexible(child: Text(label, style: style, maxLines: 1, overflow: TextOverflow.ellipsis)),
            ],
          ),
        ),
      ),
    );
  }
}
