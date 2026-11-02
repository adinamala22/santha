import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';

final complianceApiProvider = Provider<ComplianceApi>((ref) => ComplianceApi(ref.watch(apiClientProvider)));
final storeReviewsProvider = FutureProvider.autoDispose<List<StoreReview>>((ref) => ref.watch(complianceApiProvider).storeReviews());

/// Earnings tab, reviews part (M8): published customer reviews; the store can reply once to each.
class ReviewsSection extends ConsumerWidget {
  const ReviewsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final reviews = ref.watch(storeReviewsProvider).value ?? const [];
    return Column(key: const ValueKey('reviews'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: SanthaSpacing.s4),
      Text(l.reviewsTitle, style: text.titleMedium),
      if (reviews.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s2), child: Text(l.reviewsEmpty, style: const TextStyle(color: SanthaColors.slate))),
      for (final r in reviews)
        Card(
          key: ValueKey('review-${r.orderId}'),
          child: ListTile(
            title: Semantics(label: l.reviewStars(r.storeStars), child: ExcludeSemantics(child: Text('★' * r.storeStars + '☆' * (5 - r.storeStars), style: const TextStyle(color: SanthaColors.marigold)))),
            subtitle: Text([
              if (r.comment != null) '“${r.comment}”',
              if (r.reply != null) l.reviewYourReply(r.reply!),
            ].join('\n')),
            trailing: r.reply == null ? TextButton(key: ValueKey('reply-${r.orderId}'), onPressed: () => _reply(context, ref, r), child: Text(l.reviewReply)) : null,
          ),
        ),
    ]);
  }

  Future<void> _reply(BuildContext context, WidgetRef ref, StoreReview r) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final text = await showModalBottomSheet<String>(context: context, isScrollControlled: true, builder: (_) => const _ReplySheet());
    if (text == null) return;
    try {
      await ref.read(complianceApiProvider).replyToReview(r.orderId, text);
      ref.read(analyticsProvider).track('review_replied', {'order_id': r.orderId});
      messenger.showSnackBar(SnackBar(content: Text(l.reviewReplySent)));
    } on ApiException {
      messenger.showSnackBar(SnackBar(content: Text(l.errorGeneric)));
    }
    ref.invalidate(storeReviewsProvider);
  }
}

class _ReplySheet extends StatefulWidget {
  const _ReplySheet();

  @override
  State<_ReplySheet> createState() => _ReplySheetState();
}

class _ReplySheetState extends State<_ReplySheet> {
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
          Text(l.reviewReplyTitle, style: Theme.of(context).textTheme.titleMedium),
          TextField(key: const ValueKey('reply-text'), controller: _c, maxLines: 3, maxLength: 500, decoration: InputDecoration(hintText: l.reviewReplyHint), onChanged: (_) => setState(() {})),
          SanthaButton(key: const ValueKey('reply-send'), label: l.reviewReplySend, onPressed: _c.text.trim().length >= 2 ? () => Navigator.pop(context, _c.text.trim()) : null),
        ]),
      ),
    );
  }
}
