import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../data/format.dart';
import '../features/cart/cart_controller.dart';
import '../l10n/gen/app_localizations.dart';

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => Center(
        child: Semantics(
          label: AppLocalizations.of(context).loading,
          child: const Padding(padding: EdgeInsets.all(SanthaSpacing.s8), child: CircularProgressIndicator(color: SanthaColors.indigo)),
        ),
      );
}

/// Error with a retry button. [ApiException] codes are never shown raw.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.onRetry, this.message});
  final VoidCallback onRetry;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(SanthaSpacing.s6),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off_rounded, size: 40, color: SanthaColors.slate),
          const SizedBox(height: SanthaSpacing.s3),
          Text(message ?? l.errorLoad, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s4),
          SanthaButton(label: l.retry, variant: SanthaButtonVariant.outline, expand: false, onPressed: onRetry),
        ]),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.message, this.icon = Icons.storefront_outlined, this.action});
  final String message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(SanthaSpacing.s8),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 44, color: SanthaColors.indigo300),
          const SizedBox(height: SanthaSpacing.s3),
          Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: SanthaColors.slate)),
          if (action != null) ...[const SizedBox(height: SanthaSpacing.s4), action!],
        ]),
      );
}

/// Shown above content served from the offline cache.
class StaleBanner extends StatelessWidget {
  const StaleBanner({super.key, required this.savedAt});
  final DateTime savedAt;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Semantics(
      liveRegion: true,
      child: Container(
        key: const ValueKey('stale-banner'),
        width: double.infinity,
        color: SanthaColors.marigold100,
        padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s4, vertical: SanthaSpacing.s2),
        child: Row(children: [
          const Icon(Icons.cloud_off_rounded, size: 18, color: SanthaColors.marigold600),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(child: Text(l.offlineStale(istClock(savedAt)), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SanthaColors.ink))),
        ]),
      ),
    );
  }
}

/// ADD / stepper bound to the cart. Handles the one-store-per-cart rule and max-per-order.
class CartAddButton extends ConsumerWidget {
  const CartAddButton({super.key, required this.add, required this.source, this.enabled = true, this.beforeAdd, this.afterAdd});
  final CartAdd add;
  final String source;
  final bool enabled;

  /// e.g. a kitchen page writing the chosen slot first. Return false to cancel.
  final bool Function()? beforeAdd;
  final VoidCallback? afterAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final qty = ref.watch(cartControllerProvider.select((c) => c.merchantId == add.merchantId ? c.quantityOf(add.variantId) : 0));
    return Semantics(
      label: qty == 0 ? '${l.add} ${add.name}' : '${add.name}: $qty',
      child: AddButton(
        quantity: qty,
        addLabel: l.add,
        enabled: enabled,
        onAdd: () => addToCart(context, ref, add, source: source, beforeAdd: beforeAdd).then((_) => afterAdd?.call()),
        onRemove: () => ref.read(cartControllerProvider.notifier).remove(add.variantId),
      ),
    );
  }
}

Future<void> addToCart(BuildContext context, WidgetRef ref, CartAdd add, {required String source, bool Function()? beforeAdd}) async {
  if (beforeAdd != null && !beforeAdd()) return;
  final cart = ref.read(cartControllerProvider.notifier);
  final l = AppLocalizations.of(context);
  switch (cart.add(add, source: source)) {
    case AddOutcome.added:
      return;
    case AddOutcome.maxReached:
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.maxReached(add.maxPerOrder ?? 0))));
    case AddOutcome.otherStore:
      final current = ref.read(cartControllerProvider).merchantName ?? '';
      final replace = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l.replaceCartTitle),
          content: Text(l.replaceCartBody(current)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.keepCart)),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.replaceCart)),
          ],
        ),
      );
      if (replace == true) {
        ref.read(analyticsProvider).track('cart_merchant_switch', {'from_merchant_id': ref.read(cartControllerProvider).merchantId, 'to_merchant_id': add.merchantId});
        cart.add(add, source: source, replace: true);
      }
  }
}

/// Sticky cart bar for one store; hidden when the cart is empty or holds another store.
class CartBar extends ConsumerWidget {
  const CartBar({super.key, this.merchantId, this.action, this.slotLabel});
  final String? merchantId;
  final String? action;
  final String? slotLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final cart = ref.watch(cartControllerProvider);
    if (cart.isEmpty || (merchantId != null && cart.merchantId != merchantId)) return const SizedBox.shrink();
    final summary = [l.cartSummary(cart.count, rupees(cart.totalPaise)), ?slotLabel].join(' · ');
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SanthaSpacing.s4, SanthaSpacing.s2, SanthaSpacing.s4, SanthaSpacing.s3),
        child: StickyCartBar(key: const ValueKey('cart-bar'), summary: summary, action: action ?? l.viewCart, onTap: () => showCartSheet(context)),
      ),
    );
  }
}

/// Cart review. Checkout and payment arrive in M4.
Future<void> showCartSheet(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => const _CartSheet(),
    );

class _CartSheet extends ConsumerWidget {
  const _CartSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final cart = ref.watch(cartControllerProvider);
    if (cart.isEmpty) return const SizedBox(height: 120);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, 0, SanthaSpacing.s5, SanthaSpacing.s4),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.cartTitle, style: text.titleLarge),
          Text(l.cartFrom(cart.merchantName ?? ''), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s3),
          for (final line in cart.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s2),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(line.name, style: text.bodyMedium),
                    Text('${line.variantLabel} · ${rupees(line.pricePaise)}', style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                  ]),
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
                SizedBox(width: 64, child: Text(rupees(line.totalPaise), textAlign: TextAlign.end, style: text.titleSmall)),
              ]),
            ),
          const Divider(height: SanthaSpacing.s6),
          Row(children: [
            Expanded(child: Text(l.itemTotal, style: text.titleMedium)),
            Text(rupees(cart.totalPaise), style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          ]),
          const SizedBox(height: SanthaSpacing.s3),
          Text(l.checkoutSoon, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s3),
          SanthaButton(label: l.clearCart, variant: SanthaButtonVariant.outline, onPressed: () {
            ref.read(cartControllerProvider.notifier).clear();
            Navigator.pop(context);
          }),
        ]),
      ),
    );
  }
}

/// FSSAI-style food mark for an item.
Widget? foodMarkFor(BuildContext context, FoodMark? m) {
  if (m == null) return null;
  final l = AppLocalizations.of(context);
  return switch (m) {
    FoodMark.veg => FoodMarkIcon(FoodMarkKind.veg, semanticsLabel: l.veg),
    FoodMark.nonVeg => FoodMarkIcon(FoodMarkKind.nonVeg, semanticsLabel: l.nonVeg),
    FoodMark.egg => FoodMarkIcon(FoodMarkKind.egg, semanticsLabel: l.egg),
  };
}
