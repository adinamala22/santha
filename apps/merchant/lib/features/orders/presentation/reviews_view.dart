import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';

final complianceApiProvider = Provider<ComplianceApi>((ref) => ComplianceApi(ref.watch(apiClientProvider)));
final storeReviewsProvider = FutureProvider.autoDispose<({RatingSummary summary, List<StoreReview> items})>((ref) => ref.watch(complianceApiProvider).merchantReviews());

/// Below this average a coaching tip is shown (the consumer "4★ & above" filter leaves the store out).
const _goodRating = 4.0;

/// Earnings tab, reviews part (M8): the store's rating (1–5 breakdown, coaching tip when low) and
/// published customer reviews; the store can reply once to each.
class ReviewsSection extends ConsumerWidget {
  const ReviewsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final data = ref.watch(storeReviewsProvider).value;
    final summary = data?.summary ?? RatingSummary.empty;
    final reviews = data?.items ?? const <StoreReview>[];
    return Column(key: const ValueKey('reviews'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: SanthaSpacing.s4),
      Text(l.storeRatingTitle, style: text.titleMedium),
      const SizedBox(height: SanthaSpacing.s2),
      RatingBreakdown(
        key: const ValueKey('store-rating'),
        avg: summary.avg,
        count: summary.count,
        distribution: summary.distribution,
        countLabel: l.ratingsCount(summary.count),
        emptyLabel: l.storeNoRatings,
        starsSemantics: l.ratedOutOf5((summary.avg ?? 0).toStringAsFixed(1)),
        barSemantics: (stars, n) => l.starBar(stars, n),
      ),
      if (summary.avg case final avg? when avg < _goodRating)
        Container(
          key: const ValueKey('rating-tip'),
          margin: const EdgeInsets.only(top: SanthaSpacing.s3),
          padding: const EdgeInsets.all(SanthaSpacing.s3),
          decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.md)),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.lightbulb_outline, size: 18, color: SanthaColors.marigold600),
            const SizedBox(width: SanthaSpacing.s2),
            Expanded(child: Text(l.ratingLowTip, style: text.bodySmall)),
          ]),
        ),
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
