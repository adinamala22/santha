import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../common/widgets.dart';
import '../../../data/discovery_providers.dart';
import '../../../data/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../location/location_page.dart';

/// Bottom navigation: Home · Search · Orders · Account. The cart bar sits above it on Home.
class HomeShell extends StatelessWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
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

class OrdersPage extends StatelessWidget {
  const OrdersPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.navOrders)),
      body: Center(child: EmptyView(message: l.ordersEmpty, icon: Icons.receipt_long_outlined)),
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
                      if (v == 'default') await api.makeDefault(a.id);
                      if (v == 'delete') await api.remove(a.id);
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
        TextButton.icon(onPressed: () => context.push('/location/pin'), icon: const Icon(Icons.add_location_alt_outlined), label: Text(l.addAddress)),
        const SizedBox(height: SanthaSpacing.s6),
        SanthaButton(label: l.signOut, variant: SanthaButtonVariant.outline, onPressed: () => ref.read(authControllerProvider.notifier).signOut()),
      ]),
    );
  }
}
