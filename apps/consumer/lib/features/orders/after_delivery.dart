import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../data/format.dart';
import '../../data/order_providers.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import '../checkout/payment_sheet.dart';
import 'tracking_view.dart';

Duration? _noRetry(int retryCount, Object error) => null;

/// Same windows as the server (issues.service, money.ts issueWindowMin): home kitchens 2 h, fashion 48 h,
/// everything else 24 h after delivery. The server still decides; this only hides a button that would fail.
bool canReportIssue(Order o, {DateTime? now}) {
  final delivered = o.history.where((h) => h.state == OrderState.delivered).firstOrNull?.at;
  if (delivered == null) return true;
  final window = switch (o.merchantType) {
    'home_kitchen' => const Duration(hours: 2),
    'fashion' => const Duration(hours: 48),
    _ => const Duration(hours: 24),
  };
  return (now ?? DateTime.now()).difference(delivered) <= window;
}

final issuesProvider = FutureProvider.autoDispose.family<List<Issue>, String>(retry: _noRetry, (ref, orderId) => ref.watch(checkoutApiProvider).issues(orderId));

/// The customer's rating of this order (null until rated), so a rated order is not offered the stars again.
final myRatingProvider = FutureProvider.autoDispose.family<OrderRating?, String>(retry: _noRetry, (ref, orderId) => ref.watch(checkoutApiProvider).myRating(orderId));

/// Whether the delivery partner can still be tipped for this order (ADR-037); null until known.
final tipOfferProvider = FutureProvider.autoDispose.family<TipOffer, String>(retry: _noRetry, (ref, orderId) => ref.watch(checkoutApiProvider).tipOffer(orderId));

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
  bool _sending = false;
  bool _tipping = false;
  final _comment = TextEditingController();

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _send(bool riderDelivered) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final comment = _comment.text.trim();
    setState(() => _sending = true);
    try {
      await ref.read(checkoutApiProvider).rate(widget.order.id, storeStars: _store, riderStars: riderDelivered && _rider > 0 ? _rider : null, comment: comment.isEmpty ? null : comment);
      ref.read(analyticsProvider).track('rating_submitted', {'order_id': widget.order.id, 'store_stars': _store, 'rider_stars': _rider, 'has_comment': comment.isNotEmpty});
    } on ApiException catch (e) {
      if (e.code != 'ALREADY_EXISTS') {
        if (mounted) setState(() => _sending = false);
        messenger.showSnackBar(SnackBar(content: Text(l.rateFailed)));
        return;
      }
    }
    ref.invalidate(myRatingProvider(widget.order.id));
    if (!mounted) return;
    setState(() {
      _rated = true;
      _sending = false;
    });
    messenger.showSnackBar(SnackBar(content: Text(l.rateThanks)));
  }

  /// Tip after delivery (ADR-037): its own payment, 100% to the rider, within 24 hours of the delivery.
  Future<void> _tip(int amountPaise) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _tipping = true);
    try {
      final api = ref.read(checkoutApiProvider);
      ref.read(analyticsProvider).track('tip_after_delivery_started', {'order_id': widget.order.id, 'amount_paise': amountPaise});
      final payment = await api.startTip(widget.order.id, amountPaise);
      if (!mounted) return;
      final outcome = await ref.read(paymentSheetProvider).pay(context, widget.order, payment);
      if (outcome is Paid) {
        ref.read(analyticsProvider).track('tip_after_delivery_paid', {'order_id': widget.order.id, 'amount_paise': amountPaise});
        messenger.showSnackBar(SnackBar(content: Text(l.tipLaterThanks)));
      } else if (outcome is PaymentFailed) {
        messenger.showSnackBar(SnackBar(content: Text(l.tipLaterNotPaid)));
      }
    } on ApiException {
      messenger.showSnackBar(SnackBar(content: Text(l.tipLaterNotPaid)));
    } finally {
      ref.invalidate(tipOfferProvider(widget.order.id));
      if (mounted) setState(() => _tipping = false);
    }
  }

  Widget _tipSection(AppLocalizations l, TextTheme text, TipOffer offer) {
    if (offer.tippedPaise > 0) {
      return Padding(
        padding: const EdgeInsets.only(bottom: SanthaSpacing.s4),
        child: Text(l.tipLaterDone(rupees(offer.tippedPaise)), key: const ValueKey('tip-later-done'), style: text.bodyMedium?.copyWith(color: SanthaColors.leaf)),
      );
    }
    if (!offer.canTip) return const SizedBox.shrink();
    return Padding(
      key: const ValueKey('tip-later'),
      padding: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(l.tipLaterTitle, style: text.titleMedium),
        Text(l.tipLaterNote, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
        const SizedBox(height: SanthaSpacing.s2),
        Wrap(spacing: SanthaSpacing.s2, children: [
          for (final t in offer.choicesPaise)
            ActionChip(key: ValueKey('tip-later-$t'), label: Text(rupees(t)), onPressed: _tipping ? null : () => _tip(t)),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final issues = ref.watch(issuesProvider(widget.order.id)).value ?? const [];
    final tipOffer = ref.watch(tipOfferProvider(widget.order.id)).value;
    // The delivery is rated when a Santha rider or the store's own staff brought it (ADR-039).
    final mode = ref.watch(trackingProvider(widget.order.id)).value?.mode;
    final riderDelivered = mode == DeliveryMode.rider || mode == DeliveryMode.self;
    final mine = ref.watch(myRatingProvider(widget.order.id));
    // Until we know whether the order is rated, show neither the stars nor "Your rating".
    final existing = mine.value;
    final canRate = !_rated && mine.hasValue && existing == null;
    return Column(key: const ValueKey('after-delivery'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (existing != null) ...[
        _YourRating(rating: existing),
        const SizedBox(height: SanthaSpacing.s4),
      ],
      if (canRate) ...[
        Text(l.rateTitle, style: text.titleMedium),
        _Stars(key: const ValueKey('stars-store'), label: l.rateStore, value: _store, onChanged: (v) => setState(() => _store = v)),
        if (riderDelivered) _Stars(key: const ValueKey('stars-rider'), label: l.rateRider, value: _rider, onChanged: (v) => setState(() => _rider = v)),
        if (_store > 0) ...[
          TextField(
            key: const ValueKey('rating-comment'),
            controller: _comment,
            maxLength: 500,
            minLines: 2,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l.rateCommentHint, helperText: l.rateCommentNote, helperMaxLines: 2, border: const OutlineInputBorder()),
          ),
          const SizedBox(height: SanthaSpacing.s2),
          SanthaButton(
            key: const ValueKey('send-rating'),
            label: l.rateSend,
            variant: SanthaButtonVariant.outline,
            loading: _sending,
            onPressed: () => _send(riderDelivered),
          ),
        ],
        const SizedBox(height: SanthaSpacing.s4),
      ],
      if (tipOffer != null) _tipSection(l, text, tipOffer),
      for (final i in issues) _IssueOutcome(issue: i),
      if (canReportIssue(widget.order))
        SanthaButton(
          key: const ValueKey('report-problem'),
          label: l.reportProblem,
          variant: SanthaButtonVariant.outline,
          onPressed: () => _report(context),
        )
      else
        Text(l.issueWindowClosed, key: const ValueKey('report-window-closed'), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
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

class _YourRating extends StatelessWidget {
  const _YourRating({required this.rating});
  final OrderRating rating;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Column(key: const ValueKey('your-rating'), crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(l.youRated, style: text.titleMedium),
      const SizedBox(height: SanthaSpacing.s1),
      Row(children: [
        Expanded(child: Text(l.rateStore)),
        StarRow(value: rating.storeStars.toDouble(), semanticLabel: l.rateStars(rating.storeStars)),
      ]),
      if (rating.riderStars case final r?)
        Row(children: [
          Expanded(child: Text(l.rateRider)),
          StarRow(value: r.toDouble(), semanticLabel: l.rateStars(r)),
        ]),
      if (rating.comment case final c?) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s1), child: Text('“$c”', style: text.bodySmall?.copyWith(color: SanthaColors.slate))),
    ]);
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
