import 'package:flutter/material.dart';

import '../tokens.dart';

enum SanthaButtonVariant {
  /// Indigo fill, white label — the default call to action.
  primary,

  /// Marigold fill, indigo label — accent CTAs ("Accept", "Download the app").
  accent,

  /// White fill, indigo outline and label — secondary actions.
  outline,
}

/// The one button used across Santha apps. 52 px tall (≥44 px touch target), radius 14.
class SanthaButton extends StatelessWidget {
  const SanthaButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = SanthaButtonVariant.primary,
    this.loading = false,
    this.icon,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final SanthaButtonVariant variant;

  /// Shows a spinner and blocks taps; the label stays in the semantics tree.
  final bool loading;
  final IconData? icon;

  /// Fill the available width (default) or size to content.
  final bool expand;

  static const double height = 52;
  static const double radius = 14;

  @override
  Widget build(BuildContext context) {
    final (bg, bgPressed, fg, border) = switch (variant) {
      SanthaButtonVariant.primary => (SanthaColors.indigo, SanthaColors.indigo700, SanthaColors.white, null),
      SanthaButtonVariant.accent => (SanthaColors.marigold, SanthaColors.marigold600, SanthaColors.indigo, null),
      SanthaButtonVariant.outline => (SanthaColors.white, SanthaColors.indigo100, SanthaColors.indigo, SanthaColors.indigo),
    };
    final enabled = onPressed != null && !loading;
    final textStyle = Theme.of(context).textTheme.labelLarge?.copyWith(fontSize: 15, fontWeight: FontWeight.w500);

    final style = ButtonStyle(
      minimumSize: WidgetStatePropertyAll(Size(expand ? double.infinity : 0, height)),
      padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: SanthaSpacing.s6)),
      shape: WidgetStatePropertyAll(
        RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radius),
          side: border == null ? BorderSide.none : BorderSide(color: border, width: 1.5),
        ),
      ),
      backgroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return bg.withValues(alpha: loading ? 1.0 : 0.45);
        if (states.contains(WidgetState.pressed)) return bgPressed;
        return bg;
      }),
      foregroundColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.disabled) && !loading ? fg.withValues(alpha: 0.7) : fg,
      ),
      overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      textStyle: WidgetStatePropertyAll(textStyle),
      elevation: const WidgetStatePropertyAll(0),
    );

    final child = loading
        ? SizedBox.square(
            dimension: 22,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: fg),
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: SanthaSpacing.s2)],
              Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
            ],
          );

    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      excludeSemantics: true,
      child: FilledButton(onPressed: enabled ? onPressed : null, style: style, child: child),
    );
  }
}
