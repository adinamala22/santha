import 'package:flutter/material.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../data/format.dart';
import '../../l10n/gen/app_localizations.dart';

/// Bill breakdown: items, fees (waived ones struck through as FREE), GST, coupon, total, savings.
class BillView extends StatelessWidget {
  const BillView({super.key, required this.bill});
  final Bill bill;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    String feeLabel(FeeCode c) => switch (c) {
          FeeCode.delivery => l.billDelivery,
          FeeCode.beyondRadius => l.billBeyondRadius,
          FeeCode.smallOrder => l.billSmallOrder,
          FeeCode.platform => l.billPlatform,
          FeeCode.packaging => l.billPackaging,
        };
    return Column(key: const ValueKey('bill'), children: [
      _Row(l.billItems, rupees(bill.itemsPaise)),
      for (final f in bill.fees)
        f.waivedPaise > 0
            ? _Row(feeLabel(f.code), l.billFree, struck: rupees(f.waivedPaise), valueColor: SanthaColors.leaf)
            : _Row(feeLabel(f.code), rupees(f.amountPaise)),
      for (final t in bill.taxes) _Row(t.cookedFood ? l.billGstFood(t.ratePercent) : l.billGstFees(t.ratePercent), rupees(t.amountPaise)),
      if (bill.discountPaise > 0) _Row(l.billDiscount(bill.discountCode ?? ''), '−${rupees(bill.discountPaise)}', valueColor: SanthaColors.leaf),
      const Divider(),
      Row(children: [
        Expanded(child: Text(l.billTotal, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
        Text(rupees(bill.totalPaise), key: const ValueKey('bill-total'), style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
      ]),
      if (bill.mrpSavingsPaise > 0)
        Align(alignment: Alignment.centerLeft, child: Text(l.billSavings(rupees(bill.mrpSavingsPaise)), style: text.bodySmall?.copyWith(color: SanthaColors.leaf))),
      if (bill.toFreeDeliveryPaise > 0 && bill.fees.any((f) => f.code == FeeCode.delivery && f.amountPaise > 0))
        Align(alignment: Alignment.centerLeft, child: Text(l.addMoreForFreeDelivery(rupees(bill.toFreeDeliveryPaise)), style: text.bodySmall?.copyWith(color: SanthaColors.marigold600))),
    ]);
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.struck, this.valueColor});
  final String label;
  final String value;
  final String? struck;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(children: [
        Expanded(child: Text(label, style: text.bodyMedium)),
        if (struck != null) ...[
          Text(struck!, style: text.bodySmall?.copyWith(color: SanthaColors.slate, decoration: TextDecoration.lineThrough)),
          const SizedBox(width: SanthaSpacing.s2),
        ],
        Text(value, style: text.bodyMedium?.copyWith(color: valueColor ?? SanthaColors.ink)),
      ]),
    );
  }
}
