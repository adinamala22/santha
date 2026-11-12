import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/rider_controller.dart';
import 'copy.dart';

/// The rider's own profile (ADR-040): who they are on Santha, how customers rate them, today's numbers, and the
/// language and sign-out controls that used to crowd the home bar.
class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final home = ref.watch(riderHomeProvider);
    return Scaffold(
      backgroundColor: SanthaColors.cream,
      appBar: AppBar(backgroundColor: SanthaColors.indigo, foregroundColor: SanthaColors.white, title: Text(l.profileTitle)),
      body: home.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: Text(l.apiError(e)))),
        data: (h) {
          final rating = h.rating;
          final initial = h.name.trim().isEmpty ? '?' : h.name.trim().characters.first.toUpperCase();
          return ListView(key: const ValueKey('rider-profile'), padding: const EdgeInsets.all(SanthaSpacing.s4), children: [
            Row(children: [
              CircleAvatar(radius: 32, backgroundColor: SanthaColors.indigo, child: Text(initial, style: text.headlineSmall?.copyWith(color: SanthaColors.white))),
              const SizedBox(width: SanthaSpacing.s4),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(h.name, key: const ValueKey('profile-name'), style: text.titleLarge),
                  Text(l.vehicleName(RiderVehicle.fromWire(h.vehicle)), key: const ValueKey('profile-vehicle'), style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
                ]),
              ),
            ]),
            const SizedBox(height: SanthaSpacing.s4),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(SanthaSpacing.s4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(l.profileRatingTitle, style: text.titleSmall),
                  const SizedBox(height: SanthaSpacing.s1),
                  if (rating == null)
                    Text(l.noRatingYet, key: const ValueKey('profile-rating'), style: text.bodyMedium?.copyWith(color: SanthaColors.slate))
                  else
                    Wrap(key: const ValueKey('profile-rating'), crossAxisAlignment: WrapCrossAlignment.center, spacing: SanthaSpacing.s2, children: [
                      Text(l.yourRating(rating.toStringAsFixed(1)), style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                      StarRow(value: rating, size: 16),
                    ]),
                  if (h.acceptancePct != null) ...[
                    const SizedBox(height: SanthaSpacing.s2),
                    Text(l.acceptanceLine(h.acceptancePct!), key: const ValueKey('profile-acceptance'), style: text.bodyMedium),
                  ],
                  const SizedBox(height: SanthaSpacing.s2),
                  Text(l.todayLine(h.deliveriesToday, rupees(h.earningsTodayPaise), l.duration(h.onlineMinToday)), key: const ValueKey('profile-today'), style: text.bodyMedium),
                ]),
              ),
            ),
            const SizedBox(height: SanthaSpacing.s2),
            ListTile(
              key: const ValueKey('profile-earnings'),
              leading: const Icon(Icons.account_balance_wallet),
              title: Text(l.profileEarnings),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/earnings'),
            ),
            ListTile(
              key: const ValueKey('profile-language'),
              leading: const Icon(Icons.translate),
              title: Text(l.profileLanguage),
              trailing: Text(l.switchLanguage, style: text.titleMedium),
              onTap: () => ref.read(localeControllerProvider.notifier).toggle(),
            ),
            ListTile(
              key: const ValueKey('sign-out'),
              leading: const Icon(Icons.logout),
              title: Text(l.signOut),
              onTap: () => signOutRider(context, ref),
            ),
          ]);
        },
      ),
    );
  }
}

/// Signing out goes offline first (so the online time stops counting); with a delivery in hand it is refused
/// (audit B4).
Future<void> signOutRider(BuildContext context, WidgetRef ref) async {
  final l = AppLocalizations.of(context);
  final h = ref.read(riderHomeProvider).value;
  if (h != null && h.jobs.isNotEmpty) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(l.signOutBlocked)));
    return;
  }
  if (h?.online ?? false) {
    try {
      await ref.read(riderHomeProvider.notifier).goOffline();
    } catch (_) {
      // No network: sign out anyway; the server stops offering once positions go stale.
    }
  }
  await ref.read(authControllerProvider.notifier).signOut();
}
