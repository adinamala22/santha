import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/discovery_providers.dart';
import '../../l10n/gen/app_localizations.dart';

/// Opens the store's ratings & reviews (PRD store page: rating distribution, verified-purchase
/// reviews with the store's replies).
Future<void> showStoreReviews(BuildContext context, String storeId) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: SanthaColors.white,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.95,
        builder: (_, scroll) => StoreReviewsView(storeId: storeId, controller: scroll),
      ),
    );

class StoreReviewsView extends ConsumerWidget {
  const StoreReviewsView({super.key, required this.storeId, this.controller});
  final String storeId;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final reviews = ref.watch(storeReviewsProvider(storeId));
    return switch (reviews) {
      AsyncData(:final value) => ListView(
          key: const ValueKey('store-reviews'),
          controller: controller,
          padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, 0, SanthaSpacing.s5, SanthaSpacing.s8),
          children: [
            Text(l.reviewsTitle, style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: SanthaSpacing.s4),
            RatingBreakdown(
              avg: value.summary.avg,
              count: value.summary.count,
              distribution: value.summary.distribution,
              countLabel: l.ratingsCount(value.summary.count),
              emptyLabel: l.noRatingsYet,
              starsSemantics: l.ratedOutOf5((value.summary.avg ?? 0).toStringAsFixed(1)),
              barSemantics: (stars, n) => l.starBar(stars, n),
            ),
            const SizedBox(height: SanthaSpacing.s5),
            if (value.items.isEmpty && value.summary.count > 0)
              Text(l.noWrittenReviews, style: text.bodyMedium?.copyWith(color: SanthaColors.slate))
            else
              for (final r in value.items) _ReviewTile(review: r),
          ],
        ),
      AsyncError() => ErrorView(message: l.reviewsLoadFailed, onRetry: () => ref.invalidate(storeReviewsProvider(storeId))),
      _ => const LoadingView(),
    };
  }
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({required this.review});
  final PublicReview review;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final date = DateFormat.yMMMd(l.localeName).format(review.createdAt.toLocal());
    return Padding(
      padding: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          StarRow(value: review.storeStars.toDouble(), size: 14, semanticLabel: l.rateStars(review.storeStars)),
          const SizedBox(width: SanthaSpacing.s2),
          Text(date, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
        ]),
        if (review.comment case final c?) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s1), child: Text(c, style: text.bodyMedium)),
        if (review.reply case final reply?)
          Container(
            margin: const EdgeInsets.only(top: SanthaSpacing.s2),
            padding: const EdgeInsets.all(SanthaSpacing.s3),
            decoration: BoxDecoration(color: SanthaColors.cream, borderRadius: BorderRadius.circular(SanthaRadius.md)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l.storeReply, style: text.labelSmall?.copyWith(color: SanthaColors.indigo, fontWeight: FontWeight.w600)),
              const SizedBox(height: SanthaSpacing.s1),
              Text(reply, style: text.bodySmall),
            ]),
          ),
        const Divider(height: SanthaSpacing.s6, color: SanthaColors.indigo100),
      ]),
    );
  }
}
