import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import 'features/home/data/offline_rider_api.dart';
import 'l10n/gen/app_localizations.dart';
import 'router/router.dart';
import 'support.dart';

class SanthaRiderApp extends ConsumerWidget {
  const SanthaRiderApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Push (review G1): keep this phone registered while signed in; a tapped notification (an offer or job opens the home with it).
    ref.watch(pushSyncProvider);
    ref.listen(pushTapsProvider, (_, next) {
      final tap = next.value;
      if (tap == null) return;
      ref.read(analyticsProvider).track('push_opened', {'kind': tap.kind});
      if (_openSupport(ref, tap)) return;
      ref.read(routerProvider).go('/');
    });
    // Nothing of a rider stays on the phone after sign-out, however it ended (ADR-035).
    ref.listen(authControllerProvider, (_, next) async {
      if (next is! AuthSignedOut) return;
      ref.read(riderOfflineProvider.notifier).set(null);
      try {
        await (await ref.read(riderCacheProvider.future)).clear();
      } catch (_) {}
    });
    final locale = ref.watch(localeControllerProvider);
    final config = ref.watch(appConfigProvider);
    return MaterialApp.router(
      onGenerateTitle: (context) => AppLocalizations.of(context).appName,
      debugShowCheckedModeBanner: !config.isProd,
      theme: santhaTheme(locale: locale),
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      routerConfig: ref.watch(routerProvider),
    );
  }
}

/// A support reply opens its chat (ADR-028).
bool _openSupport(WidgetRef ref, PushTap tap) => openSupportFromPush(
      tap,
      ref.read(routerProvider).routerDelegate.navigatorKey.currentState,
      () => supportStrings(lookupAppLocalizations(ref.read(localeControllerProvider))),
    );
