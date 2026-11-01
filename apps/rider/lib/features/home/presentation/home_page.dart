import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';

/// M0 placeholder shown after sign-in. Replaced by the real home screen in its milestone.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final auth = ref.watch(authControllerProvider);
    final me = auth is AuthSignedIn ? auth.me : null;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        title: Text(l.appName),
      ),
      body: ListView(
        padding: const EdgeInsets.all(SanthaSpacing.s6),
        children: [
          Text(l.homeWelcome, style: text.headlineMedium),
          const SizedBox(height: SanthaSpacing.s2),
          if (me != null)
            Text(l.signedInAs(me.phoneMasked), style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s6),
          Text(l.homeComingSoon, style: text.bodyMedium),
          const SizedBox(height: SanthaSpacing.s8),
          SanthaButton(
            label: l.signOut,
            variant: SanthaButtonVariant.outline,
            onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
    );
  }
}
