import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../catalogue/presentation/catalogue_page.dart';
import '../../onboarding/presentation/onboarding_gate.dart';
import '../../onboarding/data/onboarding_controller.dart';
import '../data/orders_controller.dart';
import 'fulfilment.dart';
import 'orders_page.dart';

/// Home for a live store (M5): bottom navigation Orders / Catalogue / Earnings / More.
class MerchantHome extends ConsumerStatefulWidget {
  const MerchantHome({super.key, required this.view});
  final MerchantView view;

  @override
  ConsumerState<MerchantHome> createState() => _MerchantHomeState();
}

class _MerchantHomeState extends ConsumerState<MerchantHome> {
  int _tab = 0;

  /// The store's open/closed-by-hours state changes with the clock: re-read it every minute so the
  /// "Closed by your hours" banner appears at closing time without a restart (off in tests).
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    if (ref.read(ordersPollEveryProvider) != null) {
      _refresh = Timer.periodic(const Duration(minutes: 1), (_) => ref.read(onboardingProvider.notifier).refreshQuietly());
    }
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      body: IndexedStack(index: _tab, children: [
        OrdersPage(view: widget.view),
        if (_tab == 1) const CataloguePage() else const SizedBox.shrink(),
        if (_tab == 2) const StatementPreviewView() else const SizedBox.shrink(),
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

