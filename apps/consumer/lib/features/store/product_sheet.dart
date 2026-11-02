import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/format.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import '../cart/cart_controller.dart';

/// Product sheet: sizes with price and MRP, stock, substitution info (shops) or portions,
/// allergens and lead time (home kitchens).
Future<void> showProductSheet(BuildContext context, WidgetRef ref, StorePage page, StoreItem item, {bool Function()? beforeAdd, VoidCallback? afterAdd}) {
  ref.read(analyticsProvider).track('item_viewed', {
    'item_id': item.id,
    'merchant_id': page.store.id,
    'variant_count': item.variants.length,
    'price_paise': item.card.pricePaise,
  });
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => ProductSheet(page: page, item: item, beforeAdd: beforeAdd, afterAdd: afterAdd),
  );
}

class ProductSheet extends ConsumerStatefulWidget {
  const ProductSheet({super.key, required this.page, required this.item, this.beforeAdd, this.afterAdd});
  final StorePage page;
  final StoreItem item;
  final bool Function()? beforeAdd;
  final VoidCallback? afterAdd;

  @override
  ConsumerState<ProductSheet> createState() => _ProductSheetState();
}

class _ProductSheetState extends ConsumerState<ProductSheet> {
  late StoreVariant _variant = widget.item.variants.firstWhere((v) => v.id == widget.item.card.variantId, orElse: () => widget.item.variants.first);

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final item = widget.item;
    final page = widget.page;
    final media = ref.watch(mediaUrlProvider);
    final kitchen = page.isKitchen;
    final available = page.store.open && _variant.stock != StockState.out && (!kitchen || item.onMenuToday) && page.deliversHere;

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, 0, SanthaSpacing.s5, SanthaSpacing.s4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Center(child: SanthaImage(url: media(item.card.imageUrl), size: 160, icon: kitchen ? Icons.restaurant : Icons.shopping_basket)),
          const SizedBox(height: SanthaSpacing.s4),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (foodMarkFor(context, item.card.foodMark) case final mark?) ...[Padding(padding: const EdgeInsets.only(top: 4), child: mark), const SizedBox(width: SanthaSpacing.s2)],
            Expanded(child: Text(item.card.displayName(l.localeName), style: text.titleLarge)),
          ]),
          if (item.card.brand != null) Text(item.card.brand!, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
          if (item.special) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s1), child: TrustBadge(label: l.special, positive: false, icon: Icons.star_outline)),
          if (item.description != null) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s2), child: Text(item.description!, style: text.bodyMedium)),
          const SizedBox(height: SanthaSpacing.s4),
          if (item.variants.length > 1) Text(l.chooseSize, style: text.titleSmall),
          RadioGroup<String>(
            groupValue: _variant.id,
            onChanged: (id) => setState(() => _variant = item.variants.firstWhere((v) => v.id == id)),
            child: Column(children: [
              for (final v in item.variants)
                RadioListTile<String>(
                  key: ValueKey('variant-${v.id}'),
                  contentPadding: EdgeInsets.zero,
                  value: v.id,
                  enabled: v.stock != StockState.out,
                  activeColor: SanthaColors.indigo,
                  title: Text(v.label),
                  subtitle: v.stock == StockState.out
                      ? Text(l.outOfStock, style: text.bodySmall?.copyWith(color: SanthaColors.chilli))
                      : v.stock == StockState.low
                          ? Text(l.lowStock, style: text.bodySmall?.copyWith(color: SanthaColors.marigold600))
                          : null,
                  secondary: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(rupees(v.pricePaise), style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                    if (v.mrpPaise != null && v.mrpPaise! > v.pricePaise)
                      Text(l.mrpLabel(rupees(v.mrpPaise!)), style: text.labelSmall?.copyWith(color: SanthaColors.slate, decoration: TextDecoration.lineThrough)),
                  ]),
                ),
            ]),
          ),
          if (kitchen) ...[
            if (item.leadTimeMin != null) _Line(icon: Icons.timer_outlined, text: l.madeFresh(item.leadTimeMin!)),
            if (item.dailyCapacity != null) _Line(icon: Icons.restaurant_outlined, text: l.portionsLeft(item.dailyCapacity!)),
            if (!item.onMenuToday) _Line(icon: Icons.event_busy_outlined, text: l.notOnMenuToday),
          ],
          if (item.allergens.isNotEmpty) _Line(icon: Icons.info_outline, text: l.allergensLine(item.allergens.map((a) => allergenName(l, a)).join(', '))),
          if (item.maxPerOrder != null) _Line(icon: Icons.production_quantity_limits, text: l.maxPerOrder(item.maxPerOrder!)),
          if (!kitchen) _Line(icon: Icons.swap_horiz, text: l.substitutionInfo),
          const SizedBox(height: SanthaSpacing.s4),
          SanthaButton(
            key: const ValueKey('sheet-add'),
            label: l.addToCart(rupees(_variant.pricePaise)),
            onPressed: !available
                ? null
                : () async {
                    final add = CartAdd(
                      merchantId: page.store.id,
                      merchantName: page.store.name,
                      itemId: item.id,
                      variantId: _variant.id,
                      name: item.card.name,
                      variantLabel: _variant.label,
                      pricePaise: _variant.pricePaise,
                      maxPerOrder: item.maxPerOrder,
                    );
                    final nav = Navigator.of(context);
                    await addToCart(context, ref, add, source: 'sheet', beforeAdd: widget.beforeAdd);
                    widget.afterAdd?.call();
                    nav.pop();
                  },
          ),
        ]),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: SanthaSpacing.s2),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 18, color: SanthaColors.slate),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SanthaColors.slate))),
        ]),
      );
}
