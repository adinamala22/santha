import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../data/format.dart';
import '../../data/order_providers.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import 'tracking_view.dart';

final issuesProvider = FutureProvider.autoDispose.family<List<Issue>, String>((ref, orderId) => ref.watch(checkoutApiProvider).issues(orderId));

/// After delivery (M7): rate the store (and rider) once, and report a problem within the window.
class AfterDelivery extends ConsumerStatefulWidget {
  const AfterDelivery({super.key, required this.order});
  final Order order;

  @override
  ConsumerState<AfterDelivery> createState() => _AfterDeliveryState();
}

class _AfterDeliveryState extends ConsumerState<AfterDelivery> {
  int _store = 0;
  int _rider = 0;
  bool _rated = false;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final issues = ref.watch(issuesProvider(widget.order.id)).value ?? const [];
    final riderDelivered = ref.watch(trackingProvider(widget.order.id)).value?.mode == DeliveryMode.rider;
    return Column(key: const ValueKey('after-delivery'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (!_rated) ...[
        Text(l.rateTitle, style: text.titleMedium),
        _Stars(key: const ValueKey('stars-store'), label: l.rateStore, value: _store, onChanged: (v) => setState(() => _store = v)),
        if (riderDelivered) _Stars(key: const ValueKey('stars-rider'), label: l.rateRider, value: _rider, onChanged: (v) => setState(() => _rider = v)),
        if (_store > 0)
          SanthaButton(
            key: const ValueKey('send-rating'),
            label: l.rateSend,
            variant: SanthaButtonVariant.outline,
            onPressed: () async {
              final messenger = ScaffoldMessenger.of(context);
              try {
                await ref.read(checkoutApiProvider).rate(widget.order.id, storeStars: _store, riderStars: riderDelivered && _rider > 0 ? _rider : null);
                ref.read(analyticsProvider).track('rating_submitted', {'order_id': widget.order.id, 'store_stars': _store, 'rider_stars': _rider});
              } on ApiException catch (e) {
                if (e.code != 'ALREADY_EXISTS') rethrow;
              }
              setState(() => _rated = true);
              messenger.showSnackBar(SnackBar(content: Text(l.rateThanks)));
            },
          ),
        const SizedBox(height: SanthaSpacing.s4),
      ],
      for (final i in issues) _IssueOutcome(issue: i),
      SanthaButton(
        key: const ValueKey('report-problem'),
        label: l.reportProblem,
        variant: SanthaButtonVariant.outline,
        onPressed: () => _report(context),
      ),
    ]);
  }

  Future<void> _report(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final picked = await showModalBottomSheet<(IssueType, List<String>, String)>(context: context, isScrollControlled: true, builder: (_) => _IssueSheet(order: widget.order));
    if (picked == null) return;
    try {
      await ref.read(checkoutApiProvider).reportIssue(widget.order.id, picked.$1, variantIds: picked.$1.needsItems ? picked.$2 : null, description: picked.$3.isEmpty ? null : picked.$3);
      ref.read(analyticsProvider).track('issue_reported', {'order_id': widget.order.id, 'type': picked.$1.wire});
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text(switch (e.code) {
          'ISSUE_WINDOW_CLOSED' => l.issueWindowClosed,
          'ALREADY_EXISTS' => l.issueAlreadyReported,
          _ => l.ordersLoadError,
        }),
      ));
    }
    ref.invalidate(issuesProvider(widget.order.id));
    ref.invalidate(orderProvider(widget.order.id));
    ref.invalidate(walletProvider);
  }
}

class _IssueOutcome extends StatelessWidget {
  const _IssueOutcome({required this.issue});
  final Issue issue;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final (text, color) = switch (issue.status) {
      IssueStatus.autoResolved || IssueStatus.approved =>
        (issue.refundDestination == 'source' ? l.issueRefundedSource(rupees(issue.refundPaise)) : l.issueRefunded(rupees(issue.refundPaise)), SanthaColors.leaf),
      IssueStatus.pendingReview => (l.issueUnderReview, SanthaColors.marigold600),
      IssueStatus.returnPickup => (l.issueReturnPickup, SanthaColors.marigold600),
      IssueStatus.rejected => (l.issueRejected, SanthaColors.slate),
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: SanthaSpacing.s3),
      child: Text(text, key: ValueKey('issue-${issue.type.wire}'), style: TextStyle(color: color)),
    );
  }
}

class _Stars extends StatelessWidget {
  const _Stars({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Row(children: [
      Expanded(child: Text(label)),
      for (var i = 1; i <= 5; i++)
        IconButton(
          key: ValueKey('${(key as ValueKey<String>).value}-$i'),
          tooltip: l.rateStars(i),
          icon: Icon(i <= value ? Icons.star : Icons.star_border, color: SanthaColors.marigold),
          onPressed: () => onChanged(i),
        ),
    ]);
  }
}

class _IssueSheet extends StatefulWidget {
  const _IssueSheet({required this.order});
  final Order order;

  @override
  State<_IssueSheet> createState() => _IssueSheetState();
}

class _IssueSheetState extends State<_IssueSheet> {
  IssueType? _type;
  final _lines = <String>{};
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    String label(IssueType t) => switch (t) {
          IssueType.missingItem => l.issueMissingItem,
          IssueType.wrongItem => l.issueWrongItem,
          IssueType.damaged => l.issueDamaged,
          IssueType.quality => l.issueQuality,
          IssueType.late => l.issueLate,
          IssueType.notDelivered => l.issueNotDelivered,
          IssueType.returnRequest => l.issueReturn,
        };
    final types = IssueType.values.where((t) => t != IssueType.returnRequest || widget.order.merchantType == 'fashion');
    final lines = widget.order.lines.where((x) => x.status != 'removed' && x.variantId != null).toList();
    final ready = _type != null && (!_type!.needsItems || _lines.isNotEmpty);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(SanthaSpacing.s4), children: [
          Text(l.whatWentWrong, style: text.titleMedium),
          RadioGroup<IssueType>(
            groupValue: _type,
            onChanged: (v) => setState(() => _type = v),
            child: Column(children: [for (final t in types) RadioListTile<IssueType>(key: ValueKey('type-${t.wire}'), value: t, title: Text(label(t)))]),
          ),
          if (_type?.needsItems ?? false) ...[
            Text(l.whichItems, style: text.titleSmall),
            for (final x in lines)
              CheckboxListTile(
                key: ValueKey('line-${x.variantId}'),
                value: _lines.contains(x.variantId),
                title: Text('${x.quantity} × ${x.name} (${x.variantLabel})'),
                onChanged: (v) => setState(() => v == true ? _lines.add(x.variantId!) : _lines.remove(x.variantId)),
              ),
          ],
          TextField(key: const ValueKey('issue-note'), controller: _note, maxLength: 500, decoration: InputDecoration(labelText: l.tellUsMore)),
          SanthaButton(
            key: const ValueKey('submit-issue'),
            label: l.submitIssue,
            onPressed: ready ? () => Navigator.pop(context, (_type!, _lines.toList(), _note.text.trim())) : null,
          ),
        ]),
      ),
    );
  }
}

/// Wallet balance and history (refund credits).
class WalletPage extends ConsumerWidget {
  const WalletPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final w = ref.watch(walletProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.walletTitle)),
      body: w.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, _) => Center(child: Text(l.ordersLoadError)),
        data: (x) => ListView(padding: const EdgeInsets.all(SanthaSpacing.s4), children: [
          Text(l.walletBalance(rupees(x.balancePaise)), key: const ValueKey('wallet-balance'), style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: SanthaSpacing.s3),
          if (x.entries.isEmpty) Text(l.walletEmpty, style: const TextStyle(color: SanthaColors.slate)),
          for (final e in x.entries)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(e.note ?? e.kind),
              subtitle: Text(istClock(e.createdAt)),
              trailing: Text('+${rupees(e.amountPaise)}', style: const TextStyle(color: SanthaColors.leaf, fontWeight: FontWeight.w600)),
            ),
        ]),
      ),
    );
  }
}
