import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../catalogue/data/catalogue_controller.dart';
import '../../catalogue/presentation/catalogue_copy.dart' show rupees;
import '../../onboarding/presentation/copy.dart';
import '../data/orders_controller.dart';
import 'fulfilment.dart';

/// Orders tab (M5, merchant-orders-hifi): store Open/Paused toggle, ringing new-order cards with
/// the accept countdown, Preparing / Ready / Out / Done tabs and today's summary.
class OrdersPage extends ConsumerWidget {
  const OrdersPage({super.key, required this.view});
  final MerchantView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final open = ref.watch(storeOpenProvider) ?? view.merchant.acceptingOrders;
    final board = ref.watch(ordersBoardProvider);
    return Scaffold(
      backgroundColor: SanthaColors.cream,
      appBar: AppBar(
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        title: Text(view.merchant.name, overflow: TextOverflow.ellipsis),
        actions: [_StoreToggle(open: open)],
      ),
      body: board.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _Retry(message: l.apiError(e), onRetry: () => ref.read(ordersBoardProvider.notifier).reload()),
        data: (b) => RefreshIndicator(
          onRefresh: () => ref.read(ordersBoardProvider.notifier).reload(),
          child: ListView(
            key: const ValueKey('orders-list'),
            padding: const EdgeInsets.all(SanthaSpacing.s4),
            children: [
              if (!open) _PausedBanner(missed: view.merchant.pausedReason == 'missed_orders'),
              for (final o in b.newOrders) _NewOrderCard(order: o, view: view),
              if (b.newOrders.isEmpty && open)
                Padding(
                  padding: const EdgeInsets.only(bottom: SanthaSpacing.s4),
                  child: Text(l.waitingForOrders, key: const ValueKey('waiting'), style: const TextStyle(color: SanthaColors.slate)),
                ),
              _Tabs(board: b),
              const SizedBox(height: SanthaSpacing.s3),
              if (b.list.items.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s8),
                  child: Text(l.emptyTab, textAlign: TextAlign.center, style: const TextStyle(color: SanthaColors.slate)),
                ),
              for (final o in b.list.items) _OrderCard(order: o, delivery: b.deliveries[o.id]),
              const SizedBox(height: SanthaSpacing.s4),
              _TodayCard(summary: b.list.summary),
            ],
          ),
        ),
      ),
    );
  }
}

class _StoreToggle extends ConsumerWidget {
  const _StoreToggle({required this.open});
  final bool open;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: SanthaSpacing.s3),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s3, vertical: SanthaSpacing.s1),
          decoration: BoxDecoration(color: open ? SanthaColors.leaf : SanthaColors.slate, borderRadius: BorderRadius.circular(SanthaRadius.pill)),
          child: Text(open ? l.storeOpen : l.storePaused, style: const TextStyle(color: SanthaColors.white, fontWeight: FontWeight.w600)),
        ),
        Semantics(
          label: l.storeToggleLabel,
          child: Switch(
            key: const ValueKey('store-toggle'),
            value: open,
            activeThumbColor: SanthaColors.white,
            activeTrackColor: SanthaColors.leaf,
            onChanged: (v) => _run(context, ref, () => ref.read(storeOpenProvider.notifier).set(v)),
          ),
        ),
      ]),
    );
  }
}

class _PausedBanner extends ConsumerWidget {
  const _PausedBanner({required this.missed});
  final bool missed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return Container(
      key: const ValueKey('paused-banner'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      padding: const EdgeInsets.all(SanthaSpacing.s4),
      decoration: BoxDecoration(color: SanthaColors.chilli.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(SanthaRadius.md)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(missed ? l.storePausedMissed : l.storePausedBanner, style: const TextStyle(color: SanthaColors.chilli)),
        const SizedBox(height: SanthaSpacing.s2),
        SanthaButton(label: l.storeResume, onPressed: () => _run(context, ref, () => ref.read(storeOpenProvider.notifier).set(true))),
      ]),
    );
  }
}

String _countdown(Duration d) {
  if (d.isNegative) return '0:00';
  final s = d.inSeconds;
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

/// Clock time in IST: every store is in Nellore, whatever time zone the phone (or CI) is set to.
String _time(BuildContext context, DateTime t) =>
    MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(t.toUtc().add(const Duration(hours: 5, minutes: 30))));

class _NewOrderCard extends ConsumerWidget {
  const _NewOrderCard({required this.order, required this.view});
  final MerchantOrder order;
  final MerchantView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final now = ref.watch(nowTickerProvider).value ?? DateTime.now();
    final left = order.acceptBy?.difference(now);
    // The countdown runs to the soft deadline (acceptBy); the order stays acceptable, with reminders,
    // until the hard expiry (expiresAt).
    final timeUp = order.expiresAt != null && !order.expiresAt!.isAfter(now);
    final late = left != null && left.isNegative;
    return Container(
      key: ValueKey('new-${order.id}'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      padding: const EdgeInsets.all(SanthaSpacing.s4),
      decoration: BoxDecoration(
        color: SanthaColors.marigold100,
        borderRadius: BorderRadius.circular(SanthaRadius.lg),
        border: Border.all(color: late ? SanthaColors.chilli : SanthaColors.marigold, width: 2),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.notifications_active, color: SanthaColors.marigold600),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(child: Text(l.newOrderTitle(order.code), style: text.titleMedium)),
        ]),
        const SizedBox(height: SanthaSpacing.s2),
        Text(
          [l.itemsCount(order.itemCount), rupees(order.itemsPaise), l.distanceKm((order.distanceM / 1000).toStringAsFixed(1))].join(' · '),
          style: text.bodyLarge,
        ),
        const SizedBox(height: SanthaSpacing.s1),
        for (final line in order.lines) Text('${line.quantity} × ${line.name} (${line.variantLabel})', style: text.bodyMedium),
        if (order.substitutesAllowed > 0) ...[
          const SizedBox(height: SanthaSpacing.s1),
          Text(l.substitutesAllowed(order.substitutesAllowed), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
        ],
        Text(order.paymentMethod == PaymentMethodChoice.cod ? l.payCod(rupees(order.codDuePaise)) : l.payOnline, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
        const SizedBox(height: SanthaSpacing.s3),
        Row(children: [
          Expanded(
            flex: 3,
            child: SanthaButton(
              key: ValueKey('accept-${order.id}'),
              label: timeUp ? l.orderTimeUp : (left == null || late ? l.acceptNow : l.acceptIn(_countdown(left))),
              onPressed: timeUp
                  ? null
                  : () async {
                      final choice = await chooseFulfilment(context, view);
                      if (choice == null || !context.mounted) return;
                      await _run(context, ref, () => ref.read(ordersBoardProvider.notifier).accept(order, mode: choice.mode, staffId: choice.staffId));
                    },
            ),
          ),
          const SizedBox(width: SanthaSpacing.s3),
          Expanded(
            flex: 2,
            child: SanthaButton(
              key: ValueKey('reject-${order.id}'),
              label: l.reject,
              variant: SanthaButtonVariant.outline,
              onPressed: timeUp ? null : () => _reject(context, ref, order),
            ),
          ),
        ]),
      ]),
    );
  }
}

const _rejectReasons = ['out_of_stock', 'store_closing', 'too_busy', 'cannot_deliver', 'other'];

Future<void> _reject(BuildContext context, WidgetRef ref, MerchantOrder order) async {
  final l = AppLocalizations.of(context);
  final reason = await showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: Text(l.rejectTitle, style: Theme.of(ctx).textTheme.titleMedium)),
        for (final r in _rejectReasons)
          ListTile(
            key: ValueKey('reason-$r'),
            title: Text(switch (r) {
              'out_of_stock' => l.rejectOutOfStock,
              'store_closing' => l.rejectStoreClosing,
              'too_busy' => l.rejectTooBusy,
              'cannot_deliver' => l.rejectCannotDeliver,
              _ => l.rejectOther,
            }),
            onTap: () => Navigator.pop(ctx, r),
          ),
      ]),
    ),
  );
  if (reason == null || !context.mounted) return;
  await _run(context, ref, () => ref.read(ordersBoardProvider.notifier).reject(order, reason));
}

class _Tabs extends ConsumerWidget {
  const _Tabs({required this.board});
  final OrdersBoard board;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final tabs = [
      (OrderBucket.preparing, l.tabPreparing),
      (OrderBucket.ready, l.tabReady),
      (OrderBucket.out, l.tabOut),
      (OrderBucket.done, l.tabDone),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        for (final (b, label) in tabs)
          Padding(
            padding: const EdgeInsets.only(right: SanthaSpacing.s2),
            child: ChoiceChip(
              key: ValueKey('tab-${b.wire}'),
              label: Text(l.tabWithCount(label, board.count(b))),
              selected: board.tab == b,
              selectedColor: SanthaColors.indigo,
              labelStyle: TextStyle(color: board.tab == b ? SanthaColors.white : SanthaColors.ink),
              showCheckmark: false,
              onSelected: (_) => ref.read(ordersBoardProvider.notifier).selectTab(b),
            ),
          ),
      ]),
    );
  }
}

class _OrderCard extends ConsumerWidget {
  const _OrderCard({required this.order, this.delivery});
  final MerchantOrder order;
  final MerchantDelivery? delivery;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final now = ref.watch(nowTickerProvider).value ?? DateTime.now();
    final preparing = order.state == OrderState.preparing || order.state == OrderState.accepted;
    double? progress;
    if (preparing && order.acceptedAt != null && order.packBy != null) {
      final total = order.packBy!.difference(order.acceptedAt!).inSeconds;
      progress = total <= 0 ? 1 : (now.difference(order.acceptedAt!).inSeconds / total).clamp(0, 1).toDouble();
    }
    final outcome = switch (order.state) {
      OrderState.cancelled => l.outcomeCancelled,
      OrderState.rejected => l.outcomeRejected,
      OrderState.expired => l.outcomeExpired,
      OrderState.delivered => l.outcomeDelivered,
      _ => null,
    };
    return Card(
      key: ValueKey('order-${order.id}'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s3),
      child: Padding(
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('#${order.code}', style: text.titleMedium)),
            if (outcome != null) Text(outcome, style: text.labelLarge?.copyWith(color: SanthaColors.slate)),
            if (preparing && order.packBy != null) Text(l.packBy(_time(context, order.packBy!)), style: text.labelLarge?.copyWith(color: SanthaColors.marigold600)),
          ]),
          const SizedBox(height: SanthaSpacing.s1),
          Text('${l.itemsCount(order.itemCount)} · ${rupees(order.itemsPaise)}', style: text.bodyMedium),
          for (final line in order.lines)
            Padding(
              padding: const EdgeInsets.only(top: SanthaSpacing.s1),
              child: Text(
                switch (line.status) {
                  LineStatus.ok => '${line.quantity} × ${line.name} (${line.variantLabel})',
                  LineStatus.removed => '${line.quantity} × ${line.name} — ${l.lineRemoved(rupees(line.refundPaise))}',
                  LineStatus.substituted => '${line.quantity} × ${line.name} — ${l.lineSubstituted('${line.substituteName} (${line.substituteVariantLabel})')}',
                },
                style: text.bodySmall?.copyWith(
                  color: line.status == LineStatus.ok ? SanthaColors.ink : SanthaColors.slate,
                  decoration: line.status == LineStatus.removed ? TextDecoration.lineThrough : null,
                ),
              ),
            ),
          if (order.addressLine != null) ...[
            const SizedBox(height: SanthaSpacing.s2),
            Text(l.deliverTo([order.addressLine!, ?order.landmark].join(', ')), style: text.bodySmall),
          ],
          if (order.instructions != null) Text(l.instructionsLabel(order.instructions!), style: text.bodySmall),
          if (order.refundedPaise > 0) Text(l.refundedToWallet(rupees(order.refundedPaise)), style: text.bodySmall?.copyWith(color: SanthaColors.leaf)),
          if (order.paymentMethod == PaymentMethodChoice.cod && order.codDuePaise > 0 && outcome == null)
            Text(l.payCod(rupees(order.codDuePaise)), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
          if (progress != null) ...[
            const SizedBox(height: SanthaSpacing.s3),
            LinearProgressIndicator(
              value: progress,
              color: progress >= 1 ? SanthaColors.chilli : SanthaColors.marigold,
              backgroundColor: SanthaColors.indigo100,
              minHeight: 6,
              borderRadius: BorderRadius.circular(SanthaRadius.pill),
            ),
          ],
          if (delivery != null) DeliveryInfo(orderId: order.id, delivery: delivery!),
          if (order.state == OrderState.preparing) ...[
            const SizedBox(height: SanthaSpacing.s3),
            Row(children: [
              Expanded(
                child: SanthaButton(
                  key: ValueKey('ready-${order.id}'),
                  label: l.markReady,
                  onPressed: () => _run(context, ref, () => ref.read(ordersBoardProvider.notifier).markReady(order)),
                ),
              ),
              const SizedBox(width: SanthaSpacing.s3),
              Expanded(
                child: SanthaButton(
                  key: ValueKey('unavailable-${order.id}'),
                  label: l.itemUnavailable,
                  variant: SanthaButtonVariant.outline,
                  onPressed: order.lines.any((x) => x.status == LineStatus.ok) ? () => _unavailable(context, ref, order) : null,
                ),
              ),
            ]),
          ],
        ]),
      ),
    );
  }
}

/// Item unavailable: pick the line, then remove it (refund) or send a substitute from this store at
/// the same price or less (the difference is refunded). A customer who said "remove it" gets no
/// substitute option.
Future<void> _unavailable(BuildContext context, WidgetRef ref, MerchantOrder order) async {
  final l = AppLocalizations.of(context);
  final line = await showModalBottomSheet<MerchantOrderLine>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: Text(l.unavailableTitle, style: Theme.of(ctx).textTheme.titleMedium)),
        for (final x in order.lines.where((x) => x.status == LineStatus.ok))
          ListTile(
            key: ValueKey('line-${x.variantId}'),
            title: Text('${x.quantity} × ${x.name} (${x.variantLabel})'),
            subtitle: Text(switch (x.substitution) {
              'similar' => l.custChoiceSimilar,
              'call_me' => l.custChoiceCallMe,
              _ => l.custChoiceRemove,
            }),
            onTap: () => Navigator.pop(ctx, x),
          ),
      ]),
    ),
  );
  if (line == null || !context.mounted) return;
  final action = await showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(key: const ValueKey('action-remove'), leading: const Icon(Icons.remove_shopping_cart), title: Text(l.unavailRemove), onTap: () => Navigator.pop(ctx, 'remove')),
        if (line.substitution != 'remove')
          ListTile(key: const ValueKey('action-substitute'), leading: const Icon(Icons.swap_horiz), title: Text(l.unavailSubstitute), onTap: () => Navigator.pop(ctx, 'substitute')),
      ]),
    ),
  );
  if (action == null || !context.mounted) return;
  final board = ref.read(ordersBoardProvider.notifier);
  if (action == 'remove') {
    await _run(context, ref, () => board.removeItem(order, line));
    return;
  }
  final items = (await ref.read(catalogueProvider.future)).items;
  if (!context.mounted) return;
  final options = [
    for (final i in items)
      if (i.status == ItemStatus.active)
        for (final v in i.variants)
          if (v.id != line.variantId && v.stock != StockState.out && v.pricePaise <= line.unitPricePaise) (i, v),
  ];
  final pick = await showModalBottomSheet<(Item, Variant)>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
        child: ListView(shrinkWrap: true, children: [
          Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: Text(l.pickSubstitute, style: Theme.of(ctx).textTheme.titleMedium)),
          if (options.isEmpty) Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: Text(l.noSubstitutes)),
          for (final (i, v) in options)
            ListTile(
              key: ValueKey('sub-${v.id}'),
              title: Text('${i.name} (${v.label})'),
              trailing: Text(rupees(v.pricePaise)),
              onTap: () => Navigator.pop(ctx, (i, v)),
            ),
        ]),
      ),
    ),
  );
  if (pick == null || !context.mounted) return;
  await _run(context, ref, () => board.substitute(order, line, pick.$1, pick.$2));
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.summary});
  final MerchantDaySummary summary;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Card(
      key: const ValueKey('today'),
      color: SanthaColors.indigo100,
      child: Padding(
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.todayTitle, style: text.titleMedium),
          const SizedBox(height: SanthaSpacing.s1),
          Text(l.todaySummary(summary.orders, rupees(summary.itemsPaise)), style: text.bodyLarge),
          Wrap(spacing: SanthaSpacing.s4, children: [
            if (summary.acceptanceRate != null) Text(l.acceptanceRate((summary.acceptanceRate! * 100).round()), style: text.bodySmall),
            if (summary.avgPrepMin != null) Text(l.avgPrep(summary.avgPrepMin!), style: text.bodySmall),
          ]),
        ]),
      ),
    );
  }
}

class _Retry extends StatelessWidget {
  const _Retry({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s6),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: SanthaSpacing.s4),
            SanthaButton(label: AppLocalizations.of(context).retry, onPressed: onRetry),
          ]),
        ),
      );
}

/// Runs an action and shows a snackbar if it fails (INVALID_STATE → "order changed").
Future<void> _run(BuildContext context, WidgetRef ref, Future<Object?> Function() fn) async {
  final l = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  try {
    await fn();
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e is ApiException && e.code == 'INVALID_STATE' ? l.orderChanged : l.apiError(e))));
  }
}
