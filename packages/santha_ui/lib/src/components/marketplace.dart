import 'package:flutter/material.dart';

import '../tokens.dart';
import 'self_delivers_badge.dart';

/// Food mark (FSSAI style): 12 px square outline with a dot (veg, leaf) or triangle (non-veg,
/// chilli); egg uses the non-veg colour with a dot, as labels in India do.
enum FoodMarkKind { veg, nonVeg, egg }

class FoodMarkIcon extends StatelessWidget {
  const FoodMarkIcon(this.kind, {super.key, this.size = 14, required this.semanticsLabel});
  final FoodMarkKind kind;
  final double size;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final color = kind == FoodMarkKind.veg ? SanthaColors.leaf : SanthaColors.chilli;
    return Semantics(
      label: semanticsLabel,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(border: Border.all(color: color, width: 1.5), borderRadius: BorderRadius.circular(2)),
        alignment: Alignment.center,
        child: kind == FoodMarkKind.nonVeg
            ? CustomPaint(size: Size.square(size * 0.5), painter: _Triangle(color))
            : Container(width: size * 0.45, height: size * 0.45, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
      ),
    );
  }
}

class _Triangle extends CustomPainter {
  _Triangle(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size s) => canvas.drawPath(
        Path()
          ..moveTo(s.width / 2, 0)
          ..lineTo(s.width, s.height)
          ..lineTo(0, s.height)
          ..close(),
        Paint()..color = color,
      );
  @override
  bool shouldRepaint(_Triangle old) => old.color != color;
}

/// Small pill used in trust rows: FSSAI, hygiene, rating (Leaf on ETA tint; neutral on indigo-100).
class TrustBadge extends StatelessWidget {
  const TrustBadge({super.key, required this.label, this.positive = true, this.icon});
  final String label;
  final bool positive;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final fg = positive ? SanthaColors.leaf : SanthaColors.indigo;
    return DecoratedBox(
      decoration: ShapeDecoration(color: positive ? SanthaColors.etaBg : SanthaColors.indigo100, shape: const StadiumBorder()),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s2, vertical: 3),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: 4)],
          Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: fg, fontWeight: FontWeight.w500))),
        ]),
      ),
    );
  }
}

/// Delivery slot for home kitchens; selected = Indigo fill. Closed/full slots are disabled.
class SlotChip extends StatelessWidget {
  const SlotChip({super.key, required this.label, required this.selected, this.onTap, this.sublabel});
  final String label;
  final String? sublabel;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final text = Theme.of(context).textTheme;
    final fg = selected ? SanthaColors.white : (enabled ? SanthaColors.ink : SanthaColors.indigo300);
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      child: Material(
        color: selected ? SanthaColors.indigo : SanthaColors.indigo100,
        shape: const StadiumBorder(),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s4, vertical: SanthaSpacing.s2),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(label, style: text.bodySmall?.copyWith(color: fg, fontWeight: FontWeight.w500)),
              if (sublabel != null) Text(sublabel!, style: text.labelSmall?.copyWith(color: selected ? SanthaColors.onDarkMuted : SanthaColors.slate)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Square photo with a neutral placeholder (cream tile + icon) while loading or when missing.
class SanthaImage extends StatelessWidget {
  const SanthaImage({super.key, required this.url, required this.size, this.icon = Icons.storefront, this.radius = SanthaRadius.md});
  final String? url;
  final double size;
  final IconData icon;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final placeholder = ColoredBox(color: SanthaColors.cream, child: Icon(icon, color: SanthaColors.marigold, size: size * 0.42));
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: SizedBox.square(
        dimension: size,
        child: url == null ? placeholder : Image.network(url!, fit: BoxFit.cover, errorBuilder: (_, _, _) => placeholder),
      ),
    );
  }
}

/// Store card (design system): 60 px image · name · meta line · ETA chip · optional self-delivers badge.
/// Closed stores are greyed with their next-open line.
class StoreCard extends StatelessWidget {
  const StoreCard({
    super.key,
    required this.name,
    required this.meta,
    this.imageUrl,
    this.eta,
    this.selfDeliversLabel,
    this.closedLabel,
    this.onTap,
    this.semanticsLabel,
  });

  final String name;
  final String meta;
  final String? imageUrl;

  /// The ETA chip (or a "Scheduled" chip for kitchens).
  final Widget? eta;
  final String? selfDeliversLabel;

  /// e.g. "Opens 7:00 am" — greys the card.
  final String? closedLabel;
  final VoidCallback? onTap;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Semantics(
      button: onTap != null,
      label: semanticsLabel,
      child: Opacity(
        opacity: closedLabel == null ? 1 : 0.55,
        child: Material(
          color: SanthaColors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), side: const BorderSide(color: SanthaColors.indigo100, width: 1.5)),
          child: InkWell(
            borderRadius: BorderRadius.circular(SanthaRadius.lg),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(SanthaSpacing.s3),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SanthaImage(url: imageUrl, size: 60, radius: 10),
                const SizedBox(width: SanthaSpacing.s4),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(name, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w500), maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(meta, style: text.bodySmall?.copyWith(color: SanthaColors.slate), maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: SanthaSpacing.s2),
                    Wrap(spacing: SanthaSpacing.s2, runSpacing: SanthaSpacing.s1, children: [
                      ?eta,
                      if (selfDeliversLabel != null) SelfDeliversBadge(label: selfDeliversLabel!),
                      if (closedLabel != null) Text(closedLabel!, style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
                    ]),
                  ]),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// ADD pill, or a − n + stepper once the item is in the cart.
class AddButton extends StatelessWidget {
  const AddButton({super.key, required this.quantity, required this.onAdd, required this.onRemove, required this.addLabel, this.enabled = true});
  final int quantity;
  final VoidCallback onAdd;
  final VoidCallback onRemove;
  final String addLabel;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.labelLarge?.copyWith(color: SanthaColors.white, fontWeight: FontWeight.w600);
    if (quantity == 0) {
      return Material(
        color: enabled ? SanthaColors.indigo : SanthaColors.indigo300,
        shape: const StadiumBorder(),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: enabled ? onAdd : null,
          child: Padding(padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s5, vertical: SanthaSpacing.s2), child: Text(addLabel, style: style)),
        ),
      );
    }
    return Material(
      color: SanthaColors.indigo,
      shape: const StadiumBorder(),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        _StepIcon(icon: Icons.remove, onTap: onRemove),
        Semantics(liveRegion: true, child: Text('$quantity', style: style)),
        _StepIcon(icon: Icons.add, onTap: enabled ? onAdd : null),
      ]),
    );
  }
}

class _StepIcon extends StatelessWidget {
  const _StepIcon({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.all(SanthaSpacing.s2), child: Icon(icon, size: 18, color: SanthaColors.white)),
      );
}

/// Product tile (grid): image · name · price (bold) · MRP strike (slate) · ADD.
/// Give it a fixed height (e.g. a grid with mainAxisExtent ≈ 250).
class ProductTile extends StatelessWidget {
  const ProductTile({
    super.key,
    required this.name,
    required this.price,
    required this.add,
    this.mrp,
    this.imageUrl,
    this.foodMark,
    this.badge,
    this.onTap,
  });

  final String name;
  final String price;
  final String? mrp;
  final String? imageUrl;
  final Widget? foodMark;
  final Widget add;

  /// e.g. "Low stock" / "Check stock".
  final String? badge;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Material(
      color: SanthaColors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), side: const BorderSide(color: SanthaColors.indigo100, width: 1.5)),
      child: InkWell(
        borderRadius: BorderRadius.circular(SanthaRadius.lg),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s2),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            AspectRatio(aspectRatio: 1.25, child: LayoutBuilder(builder: (_, c) => SanthaImage(url: imageUrl, size: c.maxWidth, icon: Icons.shopping_basket, radius: SanthaRadius.sm))),
            const SizedBox(height: SanthaSpacing.s2),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (foodMark != null) ...[Padding(padding: const EdgeInsets.only(top: 2), child: foodMark), const SizedBox(width: 4)],
              Expanded(child: Text(name, style: text.bodySmall?.copyWith(fontWeight: FontWeight.w500, color: SanthaColors.ink), maxLines: 2, overflow: TextOverflow.ellipsis)),
            ]),
            if (badge != null) Text(badge!, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.labelSmall?.copyWith(color: SanthaColors.marigold600)),
            const Spacer(),
            // Price, MRP and ADD stack (wireframe 03) so three tiles fit across a 360 dp phone.
            Wrap(crossAxisAlignment: WrapCrossAlignment.end, spacing: SanthaSpacing.s1, children: [
              Text(price, style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700, color: SanthaColors.ink)),
              if (mrp != null) Text(mrp!, style: text.labelSmall?.copyWith(color: SanthaColors.slate, decoration: TextDecoration.lineThrough)),
            ]),
            const SizedBox(height: SanthaSpacing.s1),
            Align(alignment: Alignment.centerRight, child: add),
          ]),
        ),
      ),
    );
  }
}

/// Sticky cart bar: Indigo, 50 px, radius 14 — "n items · ₹total" left, action right.
class StickyCartBar extends StatelessWidget {
  const StickyCartBar({super.key, required this.summary, required this.action, required this.onTap});
  final String summary;
  final String action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.titleSmall?.copyWith(color: SanthaColors.white, fontWeight: FontWeight.w500);
    return Semantics(
      button: true,
      label: '$summary. $action',
      excludeSemantics: true,
      child: Material(
        color: SanthaColors.indigo,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: SizedBox(
            height: 50,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s5),
              child: Row(children: [
                Expanded(child: Text(summary, style: style, maxLines: 1, overflow: TextOverflow.ellipsis)),
                Text('$action ›', style: style),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// Category grid tile: rounded sky tile with an icon on a marigold disc, label below.
class CategoryTile extends StatelessWidget {
  const CategoryTile({super.key, required this.label, required this.icon, this.onTap});
  final String label;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(SanthaRadius.lg),
        onTap: onTap,
        child: Column(children: [
          AspectRatio(
            aspectRatio: 1.35,
            child: DecoratedBox(
              decoration: BoxDecoration(color: SanthaColors.sky, borderRadius: BorderRadius.circular(SanthaRadius.lg)),
              child: Center(
                child: Container(
                  width: 34,
                  height: 34,
                  decoration: const BoxDecoration(color: SanthaColors.marigold, shape: BoxShape.circle),
                  child: Icon(icon, size: 20, color: SanthaColors.white),
                ),
              ),
            ),
          ),
          const SizedBox(height: SanthaSpacing.s1),
          Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SanthaColors.ink, height: 1.2), maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center),
        ]),
      ),
    );
  }
}

/// Promo card on Marigold 100 (home): title, sub line and an Indigo pill action.
class PromoCard extends StatelessWidget {
  const PromoCard({super.key, required this.title, required this.subtitle, required this.action, this.onTap});
  final String title;
  final String subtitle;
  final String action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(SanthaSpacing.s5),
      decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.xl)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: text.titleMedium?.copyWith(color: SanthaColors.indigo, fontWeight: FontWeight.w700)),
        const SizedBox(height: SanthaSpacing.s1),
        Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Expanded(child: Text(subtitle, style: text.bodySmall?.copyWith(color: SanthaColors.slate))),
          const SizedBox(width: SanthaSpacing.s3),
          Material(
            color: SanthaColors.indigo,
            shape: const StadiumBorder(),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s4, vertical: SanthaSpacing.s2),
                child: Text(action, style: text.labelLarge?.copyWith(color: SanthaColors.white)),
              ),
            ),
          ),
        ]),
      ]),
    );
  }
}

/// Small "Scheduled" chip for kitchens that sell by slot (instead of an ETA range).
class ScheduledChip extends StatelessWidget {
  const ScheduledChip({super.key, required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => TrustBadge(label: label, positive: false, icon: Icons.schedule);
}

