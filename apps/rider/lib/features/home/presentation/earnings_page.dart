import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
        ]),
      ),
    );
  }
}
