import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../catalogue/presentation/catalogue_copy.dart' show rupees;
import '../data/orders_controller.dart';

final payoutsProvider = FutureProvider.autoDispose<List<Payout>>((ref) => ref.watch(merchantOrdersApiProvider).payouts());
final storeRefundsProvider = FutureProvider.autoDispose<List<StoreRefund>>((ref) => ref.watch(merchantOrdersApiProvider).storeRefunds());
final disputesProvider = FutureProvider.autoDispose<List<Dispute>>((ref) => ref.watch(merchantOrdersApiProvider).disputes());

String _istDate(DateTime d) {
  final t = d.toUtc().add(const Duration(hours: 5, minutes: 30));
  return '${t.day.toString().padLeft(2, '0')}/${t.month.toString().padLeft(2, '0')}';
}

/// Earnings tab, money part (M7): nightly payouts with the commission invoice and tax lines, and refunds
/// charged to the store with a 48-hour dispute.
class MoneySection extends ConsumerWidget {
  const MoneySection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final payouts = ref.watch(payoutsProvider).value ?? const [];
    final refunds = ref.watch(storeRefundsProvider).value ?? const [];
    final disputes = ref.watch(disputesProvider).value ?? const [];
    final byRefund = {for (final d in disputes) if (d.refundId != null) d.refundId!: d};
    return Column(key: const ValueKey('money'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: SanthaSpacing.s4),
      Text(l.payoutsTitle, style: text.titleMedium),
      if (payouts.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s2), child: Text(l.payoutsEmpty, style: const TextStyle(color: SanthaColors.slate))),
      for (final p in payouts)
        Card(
          key: ValueKey('payout-${p.id}'),
          child: ListTile(
            title: Text(l.payoutLine(_istDate(p.periodStart), rupees(p.netPaise))),
            subtitle: Text([
              switch (p.status) {
                'transferred' => l.payoutTransferred,
                'on_hold' => l.payoutOnHold,
                'failed' => l.payoutFailed,
                _ => l.payoutPending,
              },
              l.payoutBreakdown(rupees(p.total('itemsPaise')), rupees(p.total('commissionPaise')), rupees(p.total('cgstPaise') + p.total('sgstPaise')), rupees(p.total('tcsPaise')), rupees(p.total('tdsPaise'))),
            ].join('\n')),
            isThreeLine: true,
          ),
        ),
      const SizedBox(height: SanthaSpacing.s4),
      Text(l.refundsChargedTitle, style: text.titleMedium),
      if (refunds.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s2), child: Text(l.refundsChargedEmpty, style: const TextStyle(color: SanthaColors.slate))),
      for (final r in refunds)
        Card(
          key: ValueKey('refund-${r.id}'),
          child: ListTile(
            title: Text(l.refundLine(r.orderCode, rupees(r.amountPaise))),
            subtitle: byRefund[r.id] == null
                ? null
                : Text(switch (byRefund[r.id]!.status) {
                    'accepted' => l.disputeAccepted,
                    'rejected' => l.disputeRejected,
                    _ => l.disputeOpen,
                  }, key: ValueKey('dispute-status-${r.id}')),
            trailing: r.disputable && byRefund[r.id] == null
                ? TextButton(key: ValueKey('dispute-${r.id}'), onPressed: () => _dispute(context, ref, r), child: Text(l.dispute))
                : null,
          ),
        ),
    ]);
  }

  Future<void> _dispute(BuildContext context, WidgetRef ref, StoreRefund r) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final reason = await showModalBottomSheet<String>(context: context, isScrollControlled: true, builder: (_) => const _DisputeSheet());
    if (reason == null) return;
    try {
      await ref.read(merchantOrdersApiProvider).openDispute(r.id, reason);
      ref.read(analyticsProvider).track('dispute_raised', {'refund_id': r.id});
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.code == 'DISPUTE_WINDOW_CLOSED' ? l.disputeWindowClosed : l.errorGeneric)));
    }
    ref.invalidate(disputesProvider);
    ref.invalidate(storeRefundsProvider);
  }
}

class _DisputeSheet extends StatefulWidget {
  const _DisputeSheet();

  @override
  State<_DisputeSheet> createState() => _DisputeSheetState();
}

class _DisputeSheetState extends State<_DisputeSheet> {
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(left: SanthaSpacing.s4, right: SanthaSpacing.s4, top: SanthaSpacing.s4, bottom: MediaQuery.of(context).viewInsets.bottom + SanthaSpacing.s4),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.disputeTitle, style: Theme.of(context).textTheme.titleMedium),
          TextField(key: const ValueKey('dispute-reason'), controller: _c, maxLines: 3, maxLength: 1000, decoration: InputDecoration(hintText: l.disputeHint), onChanged: (_) => setState(() {})),
          SanthaButton(key: const ValueKey('dispute-send'), label: l.disputeSend, onPressed: _c.text.trim().length >= 10 ? () => Navigator.pop(context, _c.text.trim()) : null),
        ]),
      ),
    );
  }
}
