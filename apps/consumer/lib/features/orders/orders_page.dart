import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/format.dart';
import '../../data/order_providers.dart';
import '../../l10n/gen/app_localizations.dart';
import '../checkout/bill_view.dart';
import '../checkout/checkout_page.dart';

String orderStateLabel(AppLocalizations l, OrderState s) => switch (s) {
      OrderState.awaitingPayment => l.state_AWAITING_PAYMENT,
      OrderState.paymentFailed => l.state_PAYMENT_FAILED,
      OrderState.placed => l.state_PLACED,
      OrderState.accepted => l.state_ACCEPTED,
      OrderState.preparing => l.state_PREPARING,
      OrderState.ready => l.state_READY,
      OrderState.pickedUp => l.state_PICKED_UP,
      OrderState.outForDelivery => l.state_OUT_FOR_DELIVERY,
      OrderState.delivered => l.state_DELIVERED,
      OrderState.cancelled => l.state_CANCELLED,
      OrderState.rejected => l.state_REJECTED,
      OrderState.expired => l.state_EXPIRED,
      OrderState.failedDelivery => l.state_FAILED_DELIVERY,
    };

bool _bad(OrderState s) => const [OrderState.paymentFailed, OrderState.cancelled, OrderState.rejected, OrderState.expired, OrderState.failedDelivery].contains(s);

class OrderStateChip extends StatelessWidget {
  const OrderStateChip({super.key, required this.state});
  final OrderState state;

  @override
  Widget build(BuildContext context) => TrustBadge(
        label: orderStateLabel(AppLocalizations.of(context), state),
        positive: !_bad(state) && state != OrderState.awaitingPayment,
        icon: _bad(state) ? Icons.error_outline : (state == OrderState.delivered ? Icons.check_circle_outline : Icons.schedule),
      );
}

/// Orders tab: newest first.
class OrdersPage extends ConsumerWidget {
  const OrdersPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final orders = ref.watch(ordersProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.navOrders)),
      body: RefreshIndicator(
        color: SanthaColors.indigo,
        onRefresh: () async => ref.refresh(ordersProvider.future).ignore(),
        child: switch (orders) {
          AsyncData(:final value) when value.isEmpty => ListView(children: [EmptyView(message: l.ordersEmpty, icon: Icons.receipt_long_outlined)]),
          AsyncData(:final value) => ListView.separated(
              padding: const EdgeInsets.all(SanthaSpacing.s4),
              itemCount: value.length,
              separatorBuilder: (_, _) => const SizedBox(height: SanthaSpacing.s3),
              itemBuilder: (_, i) {
                final o = value[i];
                return Material(
                  key: ValueKey('order-${o.id}'),
                  color: SanthaColors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), side: const BorderSide(color: SanthaColors.indigo100, width: 1.5)),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(SanthaRadius.lg),
                    onTap: () => context.push('/orders/${o.id}'),
                    child: Padding(
                      padding: const EdgeInsets.all(SanthaSpacing.s4),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(l.localeName == 'te' && o.merchantNameTe != null ? o.merchantNameTe! : o.merchantName, style: text.titleMedium)),
                          Text(rupees(o.totalPaise), style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                        ]),
                        Text('${l.orderCode(o.code)} · ${l.orderItems(o.itemCount)}', style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                        const SizedBox(height: SanthaSpacing.s2),
                        OrderStateChip(state: o.state),
                      ]),
                    ),
                  ),
                );
              },
            ),
          AsyncError() => ListView(children: [ErrorView(message: l.ordersLoadError, onRetry: () => ref.invalidate(ordersProvider))]),
          _ => const LoadingView(),
        },
      ),
    );
  }
}

/// Order detail; after checkout it opens with the "Order placed!" confirmation.
class OrderDetailPage extends ConsumerWidget {
  const OrderDetailPage({super.key, required this.id, this.justPlaced = false});
  final String id;
  final bool justPlaced;

  static const _steps = [OrderState.placed, OrderState.accepted, OrderState.preparing, OrderState.outForDelivery, OrderState.delivered];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final order = ref.watch(orderProvider(id));
    return Scaffold(
      backgroundColor: SanthaColors.white,
      appBar: AppBar(
        title: Text(order.value == null ? '' : l.orderCode(order.value!.code)),
        // Opened straight after checkout there is nothing to go back to: close to the Orders tab.
        leading: context.canPop() ? null : IconButton(key: const ValueKey('close-order'), tooltip: l.back, icon: const Icon(Icons.close), onPressed: () => context.go('/orders')),
      ),
      body: switch (order) {
        AsyncData(:final value) => ListView(padding: const EdgeInsets.all(SanthaSpacing.s5), children: [
            if (justPlaced && value.state == OrderState.placed)
              Container(
                key: const ValueKey('order-placed-banner'),
                margin: const EdgeInsets.only(bottom: SanthaSpacing.s5),
                padding: const EdgeInsets.all(SanthaSpacing.s5),
                decoration: BoxDecoration(color: SanthaColors.etaBg, borderRadius: BorderRadius.circular(SanthaRadius.xl)),
                child: Row(children: [
                  const Icon(Icons.check_circle, color: SanthaColors.leaf, size: 40),
                  const SizedBox(width: SanthaSpacing.s4),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(l.orderPlacedTitle, style: text.titleLarge?.copyWith(color: SanthaColors.leaf)),
                      Text(l.orderPlacedBody(value.merchantName), style: text.bodySmall),
                    ]),
                  ),
                ]),
              ),
            Row(children: [
              Expanded(child: Text(l.localeName == 'te' && value.merchantNameTe != null ? value.merchantNameTe! : value.merchantName, style: text.titleLarge)),
              OrderStateChip(state: value.state),
            ]),
            if (value.slotStartsAt != null)
              Padding(
                padding: const EdgeInsets.only(top: SanthaSpacing.s1),
                child: Text('${l.deliverySlot}: ${istClock(value.slotStartsAt!)}${value.slotEnd != null ? '–${clock(value.slotEnd!)}' : ''}', style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
              ),
            const SizedBox(height: SanthaSpacing.s4),
            if (!_bad(value.state) && value.state != OrderState.awaitingPayment) _Steps(order: value),
            if (value.state == OrderState.awaitingPayment && value.payment != null) ...[
              if (value.paymentDueAt != null) Text(l.payBy(istClock(value.paymentDueAt!)), style: text.bodySmall?.copyWith(color: SanthaColors.marigold600)),
              const SizedBox(height: SanthaSpacing.s2),
              SanthaButton(
                key: const ValueKey('complete-payment'),
                label: l.completePayment,
                onPressed: () async {
                  await payForOrder(context, ref, value);
                  ref.invalidate(orderProvider(id));
                  ref.invalidate(ordersProvider);
                },
              ),
            ],
            const SizedBox(height: SanthaSpacing.s5),
            for (final line in value.lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [
                  Expanded(child: Text('${line.quantity} × ${line.name} (${line.variantLabel})', style: text.bodyMedium)),
                  Text(rupees(line.linePaise), style: text.bodyMedium),
                ]),
              ),
            const SizedBox(height: SanthaSpacing.s3),
            BillView(bill: value.bill),
            const SizedBox(height: SanthaSpacing.s4),
            Text(
              value.paymentMethod == PaymentMethodChoice.cod ? l.payOnDelivery(rupees(value.totalPaise)) : (value.payment?.status == 'captured' ? l.paidOnline : l.payOnline),
              style: text.bodyMedium?.copyWith(color: SanthaColors.slate),
            ),
            const SizedBox(height: SanthaSpacing.s2),
            Text('${l.deliverToAddress}: ${value.addressLine}', style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
            if (value.instructions != null) Text(value.instructions!, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
          ]),
        AsyncError() => ErrorView(onRetry: () => ref.invalidate(orderProvider(id))),
        _ => const LoadingView(),
      },
    );
  }
}

class _Steps extends StatelessWidget {
  const _Steps({required this.order});
  final Order order;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final reached = order.history.map((h) => h.state).toSet();
    // Picked up / ready count as progress towards "on the way" in this simple view.
    if (reached.contains(OrderState.pickedUp)) reached.add(OrderState.outForDelivery);
    return Column(children: [
      for (final s in OrderDetailPage._steps)
        Row(children: [
          Icon(reached.contains(s) ? Icons.radio_button_checked : Icons.radio_button_unchecked, size: 18, color: reached.contains(s) ? SanthaColors.leaf : SanthaColors.indigo300),
          const SizedBox(width: SanthaSpacing.s2),
          Text(orderStateLabel(l, s), style: text.bodyMedium?.copyWith(color: reached.contains(s) ? SanthaColors.ink : SanthaColors.slate)),
        ]),
    ]);
  }
}

/// Wallet balance row for the account page.
class WalletTile extends ConsumerWidget {
  const WalletTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final w = ref.watch(walletProvider);
    return ListTile(
      key: const ValueKey('wallet'),
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.account_balance_wallet_outlined),
      title: Text(l.wallet),
      subtitle: Text(l.walletSub),
      trailing: Text(w.value == null ? '—' : rupees(w.value!.balancePaise), style: Theme.of(context).textTheme.titleMedium),
    );
  }
}

