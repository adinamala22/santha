import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/rider_controller.dart';
import 'job_page.dart' show launcherProvider;

/// SOS (ADR-031) in the app bar: "Call 112" dials first and also alerts Santha; "Alert Santha" sends the alert
/// with the position and the delivery in hand. Ops see it at the top of the live board.
class SosButton extends ConsumerWidget {
  const SosButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return IconButton(
      key: const ValueKey('sos'),
      tooltip: l.sosTitle,
      icon: const Icon(Icons.sos, color: SanthaColors.chilli),
      style: IconButton.styleFrom(backgroundColor: SanthaColors.white),
      onPressed: () => _open(context, ref),
    );
  }

  Future<void> _open(BuildContext context, WidgetRef ref) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final choice = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.sosTitle),
        content: Text(l.sosBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.cancel)),
          TextButton(key: const ValueKey('sos-alert'), onPressed: () => Navigator.pop(ctx, false), child: Text(l.sosAlertOnly)),
          FilledButton(
            key: const ValueKey('sos-112'),
            style: FilledButton.styleFrom(backgroundColor: SanthaColors.chilli),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l.sosCall112),
          ),
        ],
      ),
    );
    if (choice == null) return;
    // The emergency call comes first; the alert must not delay it.
    if (choice) await ref.read(launcherProvider)(Uri.parse('tel:112'));
    try {
      final p = await ref.read(locationSourceProvider)();
      await ref.read(riderApiProvider).sos(lat: p?.lat, lng: p?.lng, called112: choice);
      ref.read(analyticsProvider).track('sos_pressed', {'called_112': choice, 'has_location': p != null});
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l.sosSent)));
    } catch (_) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l.sosFailed), duration: const Duration(seconds: 8)));
    }
  }
}
