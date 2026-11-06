import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/format.dart';
import '../../data/order_providers.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import '../checkout/bill_view.dart';
import '../checkout/checkout_page.dart';
import 'after_delivery.dart';
import 'tracking_view.dart';
import '../../support.dart';

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
    // Order status changes (realtime) refresh the list while it is open.
    ref.listen(realtimeEventsProvider, (_, next) {
      final name = next.value?.name;
      if (name != null && name != 'order.location' && next.value?.orderId != null) ref.invalidate(ordersProvider);
    });
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

/// Order detail; after checkout it opens with the "Order placed!" confirmation. Live: refreshes on
/// realtime order.updated for this order, and polls while the order is still moving.
class OrderDetailPage extends ConsumerStatefulWidget {
  const OrderDetailPage({super.key, required this.id, this.justPlaced = false});
  final String id;
  final bool justPlaced;

  static const _steps = [OrderState.placed, OrderState.accepted, OrderState.preparing, OrderState.outForDelivery, OrderState.delivered];

  @override
  ConsumerState<OrderDetailPage> createState() => _OrderDetailPageState();
}

class _OrderDetailPageState extends ConsumerState<OrderDetailPage> {
  Timer? _poll;

  String get id => widget.id;
  bool get justPlaced => widget.justPlaced;

  @override
  void initState() {
    super.initState();
    final every = ref.read(orderPollEveryProvider);
    if (every != null) {
      _poll = Timer.periodic(every, (_) {
        final o = ref.read(orderProvider(id)).value;
        if (o != null && !o.state.isTerminal) ref.invalidate(orderProvider(id));
      });
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _cancel(Order order) async {
    final l = AppLocalizations.of(context);
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: Text(l.cancelTitle, style: Theme.of(ctx).textTheme.titleMedium)),
          for (final (r, label) in [('changed_mind', l.cancelChangedMind), ('ordered_by_mistake', l.cancelMistake), ('taking_too_long', l.cancelTooLong), ('other', l.cancelOther)])
            ListTile(key: ValueKey('cancel-$r'), title: Text(label), onTap: () => Navigator.pop(ctx, r)),
        ]),
      ),
    );
    if (reason == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(checkoutApiProvider).cancelOrder(order.id, reason);
      ref.read(analyticsProvider).track('order_cancelled', {'order_id': order.id, 'reason': reason});
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.code == 'INVALID_STATE' ? l.cancelFailed : l.ordersLoadError)));
    }
    ref.invalidate(orderProvider(id));
    ref.invalidate(ordersProvider);
    ref.invalidate(walletProvider);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(realtimeEventsProvider, (_, next) {
      // Location fixes only move the map (tracking_view); state changes refetch the order.
      if (next.value?.orderId == id && next.value?.name != 'order.location') {
        ref.invalidate(orderProvider(id));
        ref.invalidate(ordersProvider);
      }
    });
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
                      Text(l.orderPlacedBody(l.localeName == 'te' && value.merchantNameTe != null ? value.merchantNameTe! : value.merchantName), style: text.bodySmall),
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
            // Couldn't deliver (ADR-026): explained, and the courier can still be called.
            if (value.state == OrderState.failedDelivery)
              Container(
                key: const ValueKey('delivery-failed'),
                margin: const EdgeInsets.only(bottom: SanthaSpacing.s4),
                padding: const EdgeInsets.all(SanthaSpacing.s4),
                decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.lg)),
                child: Text(l.outcomeDeliveryFailed, style: text.bodyMedium),
              ),
            if (const [OrderState.accepted, OrderState.preparing, OrderState.ready, OrderState.pickedUp, OrderState.outForDelivery, OrderState.failedDelivery].contains(value.state)) ...[
              TrackingSection(orderId: value.id, storeName: l.localeName == 'te' && value.merchantNameTe != null ? value.merchantNameTe! : value.merchantName),
              const SizedBox(height: SanthaSpacing.s4),
            ],
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
            if (value.state == OrderState.rejected || value.state == OrderState.expired)
              Padding(
                padding: const EdgeInsets.only(top: SanthaSpacing.s2),
                child: Text(value.state == OrderState.expired ? l.outcomeTimedOut : l.outcomeStoreRejected, key: const ValueKey('outcome'), style: text.bodyMedium),
              ),
            if (value.state == OrderState.delivered) ...[const SizedBox(height: SanthaSpacing.s3), AfterDelivery(order: value)],
            if (value.refundedPaise > 0)
              Padding(
                padding: const EdgeInsets.only(top: SanthaSpacing.s2),
                child: Text(l.refundedToWallet(rupees(value.refundedPaise)), key: const ValueKey('refunded'), style: text.bodyMedium?.copyWith(color: SanthaColors.leaf)),
              ),
            if (value.canCancel) ...[
              const SizedBox(height: SanthaSpacing.s3),
              SanthaButton(key: const ValueKey('cancel-placed-order'), label: l.cancelOrder, variant: SanthaButtonVariant.outline, onPressed: () => _cancel(value)),
              Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s1), child: Text(l.cancelHint, style: text.bodySmall?.copyWith(color: SanthaColors.slate))),
            ],
            const SizedBox(height: SanthaSpacing.s5),
            for (final line in value.lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(
                      child: Text('${line.quantity} × ${line.name} (${line.variantLabel})',
                          style: text.bodyMedium?.copyWith(decoration: line.status == 'removed' ? TextDecoration.lineThrough : null)),
                    ),
                    Text(rupees(line.linePaise), style: text.bodyMedium),
                  ]),
                  if (line.status == 'removed') Text(l.lineRemovedByStore(rupees(line.refundPaise)), style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
                  if (line.status == 'substituted')
                    Text(l.lineSubstitutedBy('${line.substituteName} (${line.substituteVariantLabel})'), style: text.bodySmall?.copyWith(color: SanthaColors.marigold600)),
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
            const SizedBox(height: SanthaSpacing.s4),
            // Support chat about this order (ADR-028); one conversation per order.
            SanthaButton(
              key: const ValueKey('order-get-help'),
              label: l.supportGetHelp,
              icon: Icons.support_agent,
              variant: SanthaButtonVariant.outline,
              onPressed: () => startSupportChat(
                context,
                ref,
                strings: supportStrings(l),
                topics: supportTopics,
                orderId: value.id,
                orderCode: value.code,
                initialTopic: value.state == OrderState.delivered ? 'missing_item' : 'order_late',
              ),
            ),
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
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const WalletPage())),
      title: Text(l.wallet),
      subtitle: Text(l.walletSub),
      trailing: Text(w.value == null ? '—' : rupees(w.value!.balancePaise), style: Theme.of(context).textTheme.titleMedium),
    );
  }
}

