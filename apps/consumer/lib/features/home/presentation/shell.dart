import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../common/widgets.dart';
import '../../../data/discovery_providers.dart';
import '../../../data/order_providers.dart';
import '../../../data/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../account/privacy_page.dart';
import '../../location/location_controller.dart';
import '../../location/location_page.dart';
import '../../orders/orders_page.dart';
import '../../../support.dart';

/// Bottom navigation: Home · Search · Orders · Account. The cart bar sits above it on Home.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    ref.watch(consentSyncProvider); // records Terms + Privacy agreement once per notice version
    return Scaffold(
      body: shell,
      bottomNavigationBar: Column(mainAxisSize: MainAxisSize.min, children: [
        if (shell.currentIndex == 0) const CartBar(),
        NavigationBar(
          backgroundColor: SanthaColors.white,
          indicatorColor: SanthaColors.indigo,
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
          destinations: [
            NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home, color: SanthaColors.white), label: l.navHome),
            NavigationDestination(icon: const Icon(Icons.search), selectedIcon: const Icon(Icons.search, color: SanthaColors.white), label: l.navSearch),
            NavigationDestination(
              icon: const Icon(Icons.receipt_long_outlined),
              selectedIcon: const Icon(Icons.receipt_long, color: SanthaColors.white),
              label: l.navOrders,
            ),
            NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person, color: SanthaColors.white), label: l.navAccount),
          ],
        ),
      ]),
    );
  }
}

/// Account: language, delivery addresses, sign out.
class AccountPage extends ConsumerWidget {
  const AccountPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final auth = ref.watch(authControllerProvider);
    final me = auth is AuthSignedIn ? auth.me : null;
    final addresses = ref.watch(addressesProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l.navAccount)),
      body: ListView(padding: const EdgeInsets.all(SanthaSpacing.s5), children: [
        if (me != null) Text(l.signedInAs(me.phoneMasked), style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
        const SizedBox(height: SanthaSpacing.s3),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.translate),
          title: Text(l.language),
          subtitle: Text(l.languageValue),
          trailing: TextButton(onPressed: () => ref.read(localeControllerProvider.notifier).toggle(), child: Text(l.switchLanguage)),
        ),
        const WalletTile(),
        const _WhatsappTile(),
        ListTile(
          key: const ValueKey('open-support'),
          contentPadding: EdgeInsets.zero,
          leading: Badge(
            isLabelVisible: ref.watch(supportUnreadProvider) > 0,
            label: Text('${ref.watch(supportUnreadProvider)}'),
            child: const Icon(Icons.support_agent),
          ),
          title: Text(l.supportTitle),
          subtitle: Text(l.supportIntro, maxLines: 2, overflow: TextOverflow.ellipsis),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SupportInboxPage(strings: supportStrings(l), topics: supportTopics))),
        ),
        ListTile(
          key: const ValueKey('privacy-help'),
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.shield_outlined),
          title: Text(l.privacyHelp),
          subtitle: Text(l.privacyHelpSub),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PrivacyHelpPage())),
        ),
        const Divider(),
        Text(l.manageAddresses, style: text.titleMedium),
        switch (addresses) {
          AsyncData(:final value) when value.isEmpty => Padding(padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s2), child: Text(l.noAddresses)),
          AsyncData(:final value) => Column(children: [
              for (final a in value)
                AddressTile(
                  address: a,
                  trailing: PopupMenuButton<String>(
                    onSelected: (v) async {
                      final api = ref.read(addressApiProvider);
                      final messenger = ScaffoldMessenger.of(context);
                      try {
                        if (v == 'default') await api.makeDefault(a.id);
                        if (v == 'delete') {
                          await api.remove(a.id);
                          // Delivering to this address: keep the spot on the map, without the deleted address.
                          await ref.read(locationControllerProvider.notifier).detachAddress(a.id);
                        }
                      } on ApiException catch (e) {
                        messenger.showSnackBar(SnackBar(content: Text(e.code == ApiException.network ? l.errorNetwork : l.errorGeneric)));
                      }
                      ref.invalidate(addressesProvider);
                    },
                    itemBuilder: (_) => [
                      if (!a.isDefault) PopupMenuItem(value: 'default', child: Text(l.makeDefault)),
                      PopupMenuItem(value: 'delete', child: Text(l.deleteAddress)),
                    ],
                  ),
                ),
            ]),
          AsyncError() => ErrorView(onRetry: () => ref.invalidate(addressesProvider)),
          _ => const LoadingView(),
        },
        TextButton.icon(onPressed: () async {
            await context.push('/location/pin?return=1');
            ref.invalidate(addressesProvider);
          }, icon: const Icon(Icons.add_location_alt_outlined), label: Text(l.addAddress)),
        const SizedBox(height: SanthaSpacing.s6),
        SanthaButton(label: l.signOut, variant: SanthaButtonVariant.outline, onPressed: () => ref.read(authControllerProvider.notifier).signOut()),
      ]),
    );
  }
}

class _WhatsappTile extends ConsumerWidget {
  const _WhatsappTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final on = ref.watch(whatsappUpdatesProvider).value;
    return SwitchListTile(
      key: const ValueKey('whatsapp-updates'),
      contentPadding: EdgeInsets.zero,
      secondary: const Icon(Icons.chat_outlined),
      title: Text(l.whatsappUpdates),
      subtitle: Text(l.whatsappUpdatesSub),
      value: on ?? false,
      onChanged: on == null
          ? null
          : (v) async {
              await ref.read(checkoutApiProvider).setWhatsappUpdates(v);
              ref.read(analyticsProvider).track('whatsapp_opt_in_changed', {'on': v});
              ref.invalidate(whatsappUpdatesProvider);
            },
    );
  }
}
