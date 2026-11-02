import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/rider_controller.dart';
import 'copy.dart';

/// Today's deliveries (IST) with the pay breakdown of each.
class EarningsPage extends ConsumerWidget {
  const EarningsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final e = ref.watch(earningsProvider);
    final payouts = ref.watch(payoutsProvider).value ?? const <Payout>[];
    String day(DateTime d) {
      final t = d.toUtc().add(const Duration(hours: 5, minutes: 30));
      return '${t.day.toString().padLeft(2, '0')}/${t.month.toString().padLeft(2, '0')}';
    }
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(backgroundColor: SanthaColors.indigo, foregroundColor: SanthaColors.white, title: Text(l.earningsTitle)),
      body: e.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text(l.apiError(err))),
        data: (x) => ListView(padding: const EdgeInsets.all(SanthaSpacing.s4), children: [
          Text(l.earningsTotal(rupees(x.totalPaise), x.deliveries.length), key: const ValueKey('earnings-total'), style: text.headlineSmall),
          const SizedBox(height: SanthaSpacing.s4),
          if (x.deliveries.isEmpty) Text(l.noDeliveries, style: const TextStyle(color: SanthaColors.slate)),
          for (final d in x.deliveries)
            Card(
              child: ListTile(
                title: Text('#${d.code} · ${rupees(d.payPaise)}'),
                subtitle: Text(d.payLines.map(l.payLine).join(' + ')),
              ),
            ),
          const SizedBox(height: SanthaSpacing.s6),
          Text(l.payoutsTitle, style: text.titleMedium),
          if (payouts.isEmpty) Text(l.payoutsEmpty, style: const TextStyle(color: SanthaColors.slate)),
          for (final p in payouts)
            Card(
              key: ValueKey('payout-${p.id}'),
              child: ListTile(
                title: Text(l.payoutPeriod(day(p.periodStart), day(p.periodEnd.subtract(const Duration(seconds: 1))), rupees(p.netPaise))),
                subtitle: Text(l.payoutBreakdown(rupees(p.total('earnedPaise')), rupees(p.total('cashHeldPaise')))),
              ),
            ),
        ]),
      ),
    );
  }
}
