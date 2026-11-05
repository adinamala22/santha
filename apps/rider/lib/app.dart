import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import 'l10n/gen/app_localizations.dart';
import 'router/router.dart';

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
      ref.read(routerProvider).go('/');
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
