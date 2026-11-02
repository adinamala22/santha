import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../catalogue/presentation/catalogue_copy.dart' show rupees;
import '../data/orders_controller.dart';
import 'money_view.dart';

/// The choice made in the fulfilment sheet.
class FulfilmentChoice {
  const FulfilmentChoice(this.mode, this.staffId);
  final FulfilmentMode mode;
  final String? staffId;
}

/// Fulfilment choice at accept (wireframe merchant/02-fulfilment-choice): deliver myself (pick a staff
/// member, or the owner) or request a Santha rider. Defaults to the store setting; fashion is rider-only.
Future<FulfilmentChoice?> chooseFulfilment(BuildContext context, MerchantView view) {
  final l = AppLocalizations.of(context);
  final fashion = view.merchant.type == MerchantType.fashion;
  var mode = fashion ? FulfilmentMode.rider : view.merchant.defaultFulfilment;
  String? staffId = view.staff.isEmpty ? null : view.staff.first.id;
  return showModalBottomSheet<FulfilmentChoice>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        final text = Theme.of(ctx).textTheme;
        Widget option(FulfilmentMode m, String title, String sub) {
          final selected = mode == m;
          return Expanded(
            child: Material(
              color: selected ? SanthaColors.indigo : SanthaColors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.md), side: const BorderSide(color: SanthaColors.indigo300)),
              child: InkWell(
                key: ValueKey('mode-${m.name}'),
                borderRadius: BorderRadius.circular(SanthaRadius.md),
                onTap: fashion && m == FulfilmentMode.self ? null : () => setState(() => mode = m),
                child: Padding(
                  padding: const EdgeInsets.all(SanthaSpacing.s4),
                  child: Column(children: [
                    Text(title, textAlign: TextAlign.center, style: text.titleMedium?.copyWith(color: selected ? SanthaColors.white : SanthaColors.ink)),
                    const SizedBox(height: SanthaSpacing.s1),
                    Text(sub, textAlign: TextAlign.center, style: text.bodySmall?.copyWith(color: selected ? SanthaColors.onDarkMuted : SanthaColors.slate)),
                  ]),
                ),
              ),
            ),
          );
        }

        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(SanthaSpacing.s4),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(l.fulfilTitle, style: text.titleMedium),
              const SizedBox(height: SanthaSpacing.s3),
              Row(children: [
                option(FulfilmentMode.self, l.deliverMyself, l.deliverMyselfSub),
                const SizedBox(width: SanthaSpacing.s3),
                option(FulfilmentMode.rider, l.requestRider, l.requestRiderSub),
              ]),
              if (fashion) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s2), child: Text(l.fashionRiderOnly, style: text.bodySmall)),
              if (mode == FulfilmentMode.self) ...[
                const SizedBox(height: SanthaSpacing.s4),
                Text(l.whoDelivers, style: text.titleSmall),
                RadioGroup<String?>(
                  groupValue: staffId,
                  onChanged: (v) => setState(() => staffId = v),
                  child: Column(children: [
                    for (final s in view.staff)
                      RadioListTile<String?>(key: ValueKey('staff-${s.id}'), value: s.id, title: Text(s.name), subtitle: Text(l.staffGetsLink)),
                    RadioListTile<String?>(key: const ValueKey('staff-owner'), value: null, title: Text(l.ownerDelivers)),
                  ]),
                ),
              ],
              const SizedBox(height: SanthaSpacing.s4),
              SanthaButton(
                key: const ValueKey('confirm-accept'),
                label: l.confirmAccept,
                onPressed: () => Navigator.pop(ctx, FulfilmentChoice(mode, mode == FulfilmentMode.self ? staffId : null)),
              ),
            ]),
          ),
        );
      },
    ),
  );
}

/// Delivery status on an accepted order's card: pickup code, who delivers, the staff link, and the
/// fallback bonus offer when no rider was found.
class DeliveryInfo extends ConsumerWidget {
  const DeliveryInfo({super.key, required this.orderId, required this.delivery});
  final String orderId;
  final MerchantDelivery delivery;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final d = delivery;
    final name = d.courier?.name ?? (d.mode == DeliveryMode.tpl ? l.modePartner : '');
    final status = switch ((d.mode, d.state)) {
      (_, DeliveryState.searching) => l.searchingRider,
      (DeliveryMode.self, _) => l.staffDelivering(name),
      (_, DeliveryState.pickedUp) => l.courierOnWay(name),
      _ => l.riderComing(name),
    };
    return Container(
      key: ValueKey('delivery-$orderId'),
      margin: const EdgeInsets.only(top: SanthaSpacing.s3),
      padding: const EdgeInsets.all(SanthaSpacing.s3),
      decoration: BoxDecoration(color: SanthaColors.sky, borderRadius: BorderRadius.circular(SanthaRadius.md)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(d.mode == DeliveryMode.self ? Icons.storefront : Icons.delivery_dining, size: 18, color: SanthaColors.indigo),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(child: Text(status, style: text.bodyMedium)),
          if (d.mode != DeliveryMode.self && d.state != DeliveryState.pickedUp)
            Text(l.pickupCodeLine(d.pickupCode), key: ValueKey('pickup-code-$orderId'), style: text.titleSmall?.copyWith(color: SanthaColors.indigo)),
        ]),
        if (d.staffLink != null && d.state != DeliveryState.delivered)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: ValueKey('copy-link-$orderId'),
              icon: const Icon(Icons.link, size: 18),
              label: Text(l.copyLink),
              onPressed: () async {
                final messenger = ScaffoldMessenger.of(context);
                await Clipboard.setData(ClipboardData(text: d.staffLink!));
                messenger.showSnackBar(SnackBar(content: Text(l.linkCopied)));
              },
            ),
          ),
        if (d.state == DeliveryState.searching && d.selfBonusPaise > 0) ...[
          const SizedBox(height: SanthaSpacing.s2),
          Text(l.noRiderBonus(rupees(d.selfBonusPaise)), key: ValueKey('bonus-$orderId'), style: text.bodyMedium?.copyWith(color: SanthaColors.marigold600)),
          const SizedBox(height: SanthaSpacing.s2),
          SanthaButton(
            key: ValueKey('deliver-myself-$orderId'),
            label: l.deliverMyselfNow,
            variant: SanthaButtonVariant.outline,
            onPressed: () => ref.read(ordersBoardProvider.notifier).deliverMyself(orderId),
          ),
        ],
      ]),
    );
  }
}

/// Earnings tab (M6): today's statement preview with the commission ladder.
class StatementPreviewView extends ConsumerWidget {
  const StatementPreviewView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final s = ref.watch(statementPreviewProvider);
    String mode(DeliveryMode m) => switch (m) {
          DeliveryMode.self => l.modeSelf,
          DeliveryMode.rider => l.modeRider,
          DeliveryMode.tpl => l.modePartner,
        };
    String pct(double p) => p == p.roundToDouble() ? p.toStringAsFixed(0) : p.toStringAsFixed(1);
    return Scaffold(
      appBar: AppBar(title: Text(l.navEarnings)),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(payoutsProvider);
          ref.invalidate(storeRefundsProvider);
          ref.invalidate(disputesProvider);
          ref.invalidate(statementPreviewProvider);
          await ref.read(statementPreviewProvider.future);
        },
        child: s.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [Padding(padding: const EdgeInsets.all(SanthaSpacing.s6), child: Text(l.errorGeneric, textAlign: TextAlign.center))]),
          data: (x) => ListView(key: const ValueKey('statement'), padding: const EdgeInsets.all(SanthaSpacing.s4), children: [
            Text(l.statementTitle, style: text.titleMedium),
            const SizedBox(height: SanthaSpacing.s1),
            Text(l.statementTotal(x.orders, rupees(x.netPaise)), key: const ValueKey('statement-total'), style: text.headlineSmall),
            const SizedBox(height: SanthaSpacing.s3),
            if (x.lines.isEmpty) Text(l.statementEmpty, style: const TextStyle(color: SanthaColors.slate)),
            for (final line in x.lines)
              Card(
                child: ListTile(
                  title: Text(l.statementLineTitle(line.code, rupees(line.netPaise))),
                  subtitle: Text([
                    l.statementLineSub(mode(line.mode), rupees(line.itemsPaise), rupees(line.commissionPaise), pct(line.commissionPercent)),
                    if (line.deliveryFeeCreditPaise > 0) l.statementCredit(rupees(line.deliveryFeeCreditPaise)),
                    if (line.selfBonusPaise > 0) l.statementBonus(rupees(line.selfBonusPaise)),
                  ].join(' ')),
                ),
              ),
            const SizedBox(height: SanthaSpacing.s3),
            Text(l.statementNote, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
            const MoneySection(),
          ]),
        ),
      ),
    );
  }
}
