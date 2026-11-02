import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import 'l10n/gen/app_localizations.dart';
import 'router/router.dart';

class SanthaConsumerApp extends ConsumerStatefulWidget {
  const SanthaConsumerApp({super.key});

  @override
  ConsumerState<SanthaConsumerApp> createState() => _SanthaConsumerAppState();
}

class _SanthaConsumerAppState extends ConsumerState<SanthaConsumerApp> {
  @override
  void initState() {
    super.initState();
    ref.read(analyticsProvider).track('app_open', {'app': 'consumer', 'version': ref.read(appConfigProvider).appVersion});
  }

  @override
  Widget build(BuildContext context) {
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
