import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/rider_controller.dart';
import 'copy.dart';

/// Rider home (wireframe rider/01-offer): online toggle with zones, the ringing offer card with its
/// pay breakdown and 30-s countdown, today's summary and the current delivery.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final home = ref.watch(riderHomeProvider);
    return Scaffold(
      backgroundColor: SanthaColors.cream,
      appBar: AppBar(
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        title: Text(home.value?.name ?? l.appName),
        actions: [
          IconButton(tooltip: l.earningsTitle, icon: const Icon(Icons.account_balance_wallet), onPressed: () => context.push('/earnings')),
          IconButton(tooltip: l.switchLanguage, icon: const Icon(Icons.translate), onPressed: () => ref.read(localeControllerProvider.notifier).toggle()),
          IconButton(tooltip: l.signOut, icon: const Icon(Icons.logout), onPressed: () => ref.read(authControllerProvider.notifier).signOut()),
        ],
      ),
      body: home.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _Retry(message: l.apiError(e), onRetry: () => ref.read(riderHomeProvider.notifier).reload()),
        data: (h) => RefreshIndicator(
          onRefresh: () => ref.read(riderHomeProvider.notifier).reload(),
          child: ListView(
            key: const ValueKey('rider-home'),
            padding: const EdgeInsets.all(SanthaSpacing.s4),
            children: [
              if (h.offer != null) _OfferCard(offer: h.offer!),
              for (final j in h.jobs) _JobTile(job: j),
              if (h.offer == null && h.jobs.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s6),
                  child: Text(h.online ? l.waitingOffers : l.offlineHint, key: const ValueKey('idle'), textAlign: TextAlign.center, style: const TextStyle(color: SanthaColors.slate)),
                ),
              if (h.online && ref.watch(riderLocationOffProvider))
                Padding(padding: const EdgeInsets.only(bottom: SanthaSpacing.s3), child: Text(l.locationOff, style: const TextStyle(color: SanthaColors.chilli))),
              _TodayCard(home: h),
              const SizedBox(height: SanthaSpacing.s4),
              _StatusCard(home: h),
            ],
          ),
        ),
      ),
    );
  }
}

class _OfferCard extends ConsumerWidget {
  const _OfferCard({required this.offer});
  final RiderOffer offer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final now = ref.watch(riderNowProvider).value ?? DateTime.now();
    final left = offer.expiresAt.difference(now);
    final pickup = [l.pickupLine(offer.storeName, km(offer.pickupDistanceM)), if (offer.readyInMin != null) l.readyIn(offer.readyInMin!)].join(' · ');
    return Card(
      key: ValueKey('offer-${offer.id}'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), side: const BorderSide(color: SanthaColors.marigold, width: 2)),
      child: Padding(
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.newOrderPay(rupees(offer.payPaise)), style: text.headlineSmall),
          const SizedBox(height: SanthaSpacing.s2),
          Text(pickup, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          Text(l.dropLine(offer.dropArea, km(offer.dropDistanceM)), style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s2),
          Text(offer.payLines.map((p) => l.payLine(p)).join(' + '), key: const ValueKey('pay-breakdown'), style: text.bodyMedium?.copyWith(color: SanthaColors.indigo)),
          const SizedBox(height: SanthaSpacing.s3),
          Row(children: [
            Expanded(
              child: SanthaButton(
                key: const ValueKey('accept-offer'),
                label: l.acceptIn(countdown(left)),
                onPressed: left.isNegative
                    ? null
                    : () async {
                        final messenger = ScaffoldMessenger.of(context);
                        final router = GoRouter.of(context);
                        try {
                          final job = await ref.read(riderHomeProvider.notifier).accept(offer);
                          unawaited(router.push('/job/${job.id}'));
                        } on ApiException catch (e) {
                          messenger.showSnackBar(SnackBar(content: Text(e.code == 'OFFER_EXPIRED' || e.code == 'INVALID_STATE' ? l.offerGone : l.apiError(e))));
                        }
                      },
              ),
            ),
            const SizedBox(width: SanthaSpacing.s3),
            Expanded(
              child: SanthaButton(
                key: const ValueKey('decline-offer'),
                label: l.decline,
                variant: SanthaButtonVariant.outline,
                onPressed: () => _guard(context, () => ref.read(riderHomeProvider.notifier).decline(offer)),
              ),
            ),
          ]),
        ]),
      ),
    );
  }
}

class _JobTile extends StatelessWidget {
  const _JobTile({required this.job});
  final Job job;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Card(
      key: ValueKey('job-${job.id}'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      child: ListTile(
        leading: const Icon(Icons.delivery_dining, color: SanthaColors.indigo),
        title: Text('${l.currentDelivery} · #${job.code}'),
        subtitle: Text(switch (job.state) {
          DeliveryState.failed => l.jobFailedSub,
          DeliveryState.pickedUp => '${l.stepToCustomer} · ${job.dropLine}',
          _ => '${l.stepToStore} · ${job.storeName}',
        }),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.push('/job/${job.id}'),
      ),
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.home});
  final RiderHome home;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final rating = home.rating;
    return Card(
      key: const ValueKey('today'),
      color: SanthaColors.indigo100,
      child: Padding(
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.todayLine(home.deliveriesToday, rupees(home.earningsTodayPaise), l.duration(home.onlineMinToday)), style: text.titleSmall),
          const SizedBox(height: SanthaSpacing.s2),
          // Customers' delivery rating (it weighs in which rider gets an offer first).
          if (rating == null)
            Text(l.noRatingYet, key: const ValueKey('rider-rating'), style: text.bodySmall?.copyWith(color: SanthaColors.slate))
          else
            Semantics(
              label: '${l.ratedOutOf5(rating.toStringAsFixed(1))}. ${l.ratingHelps}',
              excludeSemantics: true,
              child: Row(key: const ValueKey('rider-rating'), children: [
                Text(l.yourRating(rating.toStringAsFixed(1)), style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(width: SanthaSpacing.s2),
                StarRow(value: rating, size: 14),
                const SizedBox(width: SanthaSpacing.s2),
                Expanded(child: Text(l.ratingHelps, style: text.bodySmall?.copyWith(color: SanthaColors.slate))),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _StatusCard extends ConsumerWidget {
  const _StatusCard({required this.home});
  final RiderHome home;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final te = Localizations.localeOf(context).languageCode == 'te';
    final zones = home.zones.isEmpty ? l.zonesAll : home.zones.map((z) => te ? z.nameTe : z.name).join(', ');
    return Material(
      color: home.online ? SanthaColors.etaBg : SanthaColors.white,
      borderRadius: BorderRadius.circular(SanthaRadius.md),
      child: SwitchListTile(
        key: const ValueKey('online-toggle'),
        title: Text(home.online ? l.onlineIn(zones) : l.statusOffline, style: TextStyle(color: home.online ? SanthaColors.leaf : SanthaColors.slate, fontWeight: FontWeight.w600)),
        subtitle: Text(l.onlineToggle),
        value: home.online,
        activeTrackColor: SanthaColors.leaf,
        onChanged: (on) async {
          final ctl = ref.read(riderHomeProvider.notifier);
          if (!on) return _guard(context, ctl.goOffline);
          final zones = await _pickZones(context, home);
          if (zones != null && context.mounted) await _guard(context, () => ctl.goOnline(zones));
        },
      ),
    );
  }
}

Future<List<String>?> _pickZones(BuildContext context, RiderHome home) {
  final l = AppLocalizations.of(context);
  final te = Localizations.localeOf(context).languageCode == 'te';
  final chosen = {...home.zones.map((z) => z.id)};
  return showModalBottomSheet<List<String>>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: Text(l.chooseZones, style: Theme.of(ctx).textTheme.titleMedium)),
          for (final z in home.allZones)
            CheckboxListTile(
              key: ValueKey('zone-${z.id}'),
              title: Text(te ? z.nameTe : z.name),
              value: chosen.contains(z.id),
              onChanged: (v) => setState(() => v == true ? chosen.add(z.id) : chosen.remove(z.id)),
            ),
          Padding(
            padding: const EdgeInsets.all(SanthaSpacing.s4),
            child: SanthaButton(key: const ValueKey('go-online'), label: l.goOnline, onPressed: () => Navigator.pop(ctx, chosen.toList())),
          ),
        ]),
      ),
    ),
  );
}

class _Retry extends StatelessWidget {
  const _Retry({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s6),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: SanthaSpacing.s4),
            SanthaButton(label: AppLocalizations.of(context).retry, onPressed: onRetry),
          ]),
        ),
      );
}

/// Runs a home action; a failure shows a message instead of an uncaught error.
Future<void> _guard(BuildContext context, Future<void> Function() fn) async {
  final l = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  try {
    await fn();
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.code == 'OFFER_EXPIRED' || e.code == 'INVALID_STATE' ? l.offerGone : l.apiError(e))));
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(l.apiError(e))));
  }
}
