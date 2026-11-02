import 'package:flutter/material.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../catalogue/presentation/catalogue_page.dart';
import '../../onboarding/presentation/onboarding_gate.dart';
import 'orders_page.dart';

/// Home for a live store (M5): bottom navigation Orders / Catalogue / Earnings / More.
class MerchantHome extends StatefulWidget {
  const MerchantHome({super.key, required this.view});
  final MerchantView view;

  @override
  State<MerchantHome> createState() => _MerchantHomeState();
}

class _MerchantHomeState extends State<MerchantHome> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      body: IndexedStack(index: _tab, children: [
        OrdersPage(view: widget.view),
        if (_tab == 1) const CataloguePage() else const SizedBox.shrink(),
        const _EarningsTab(),
        StatusPage(view: widget.view),
      ]),
      bottomNavigationBar: NavigationBar(
        key: const ValueKey('home-nav'),
        selectedIndex: _tab,
        indicatorColor: SanthaColors.marigold100,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.receipt_long), label: l.navOrders),
          NavigationDestination(icon: const Icon(Icons.inventory_2), label: l.navCatalogue),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet), label: l.navEarnings),
          NavigationDestination(icon: const Icon(Icons.more_horiz), label: l.navMore),
        ],
      ),
    );
  }
}

class _EarningsTab extends StatelessWidget {
  const _EarningsTab();

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.navEarnings)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s6),
          child: Text(l.earningsSoon, textAlign: TextAlign.center, style: const TextStyle(color: SanthaColors.slate)),
        ),
      ),
    );
  }
}
