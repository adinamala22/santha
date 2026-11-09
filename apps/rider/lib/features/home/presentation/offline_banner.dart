import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/offline_rider_api.dart';
import '../data/rider_controller.dart';

/// Shown while the screens are the copy saved on the phone because the network is down (ADR-035).
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final since = ref.watch(riderOfflineProvider);
    if (since == null) return const SizedBox.shrink();
    final l = AppLocalizations.of(context);
    final now = ref.watch(riderNowProvider).value ?? DateTime.now();
    final minutes = now.difference(since).inMinutes;
    return Container(
      key: const ValueKey('offline-banner'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s3),
      padding: const EdgeInsets.all(SanthaSpacing.s3),
      decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.md)),
      child: Row(children: [
        const Icon(Icons.cloud_off, color: SanthaColors.marigold600),
        const SizedBox(width: SanthaSpacing.s3),
        Expanded(child: Text(l.savedCopyBanner(minutes < 1 ? 1 : minutes))),
      ]),
    );
  }
}
