import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/format.dart';
import '../../l10n/gen/app_localizations.dart';
import 'cart_controller.dart';

String substitutionLabel(AppLocalizations l, Substitution s) => switch (s) {
  Substitution.callMe => l.subCallMe,
  Substitution.similar => l.subSimilar,
  Substitution.remove => l.subRemove,
};

/// The cart: lines with steppers and a per-item "if unavailable" preference, then checkout.
class CartPage extends ConsumerStatefulWidget {
  const CartPage({super.key});

  @override
  ConsumerState<CartPage> createState() => _CartPageState();
}

class _CartPageState extends ConsumerState<CartPage> {
  @override
  void initState() {
    super.initState();
    final c = ref.read(cartControllerProvider);
    ref.read(analyticsProvider).track('cart_viewed', {'merchant_id': c.merchantId, 'item_count': c.count, 'items_paise': c.totalPaise});
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final cart = ref.watch(cartControllerProvider);

    return Scaffold(
      backgroundColor: SanthaColors.white,
      appBar: AppBar(title: Text(l.cartTitle)),
      body: cart.isEmpty
          ? Center(
              child: EmptyView(
                message: l.cartEmpty,
                icon: Icons.shopping_basket_outlined,
                action: SanthaButton(label: l.browseStores, expand: false, onPressed: () => context.go('/')),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(SanthaSpacing.s5),
              children: [
                Text(l.cartFrom(cart.merchantName ?? ''), style: text.titleMedium),
                const SizedBox(height: SanthaSpacing.s3),
                for (final line in cart.lines) _CartLineTile(cart: cart, line: line),
                const Divider(height: SanthaSpacing.s6),
                Row(
                  children: [
                    Expanded(child: Text(l.itemTotal, style: text.titleMedium)),
                    Text(rupees(cart.totalPaise), style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  ],
                ),
                const SizedBox(height: SanthaSpacing.s2),
                Text(l.pricesInclusive, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
              ],
            ),
      bottomNavigationBar: cart.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s2, SanthaSpacing.s5, SanthaSpacing.s3),
                child: SanthaButton(key: const ValueKey('to-checkout'), label: l.proceedToCheckout, onPressed: () => context.push('/checkout')),
              ),
            ),
    );
  }
}

class _CartLineTile extends ConsumerWidget {
  const _CartLineTile({required this.cart, required this.line});
  final Cart cart;
  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(line.name, style: text.bodyMedium),
                    Text('${line.variantLabel} · ${rupees(line.pricePaise)}', style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                  ],
                ),
              ),
              CartAddButton(
                source: 'cart',
                add: CartAdd(
                  merchantId: cart.merchantId!,
                  merchantName: cart.merchantName ?? '',
                  itemId: line.itemId,
                  variantId: line.variantId,
                  name: line.name,
                  variantLabel: line.variantLabel,
                  pricePaise: line.pricePaise,
                  maxPerOrder: line.maxPerOrder,
                ),
              ),
              const SizedBox(width: SanthaSpacing.s3),
              SizedBox(
                width: 64,
                child: Text(rupees(line.totalPaise), textAlign: TextAlign.end, style: text.titleSmall),
              ),
            ],
          ),
          Row(
            children: [
              Text('${l.ifUnavailable}: ', style: text.labelSmall?.copyWith(color: SanthaColors.slate)),
              Flexible(
                child: DropdownButton<Substitution>(
                  key: ValueKey('sub-${line.variantId}'),
                  value: line.substitution,
                  isDense: true,
                  isExpanded: true,
                  underline: const SizedBox.shrink(),
                  style: text.labelSmall?.copyWith(color: SanthaColors.indigo),
                  items: [for (final s in Substitution.values) DropdownMenuItem(value: s, child: Text(substitutionLabel(l, s)))],
                  onChanged: (s) => s == null ? null : ref.read(cartControllerProvider.notifier).setSubstitution(line.variantId, s),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
