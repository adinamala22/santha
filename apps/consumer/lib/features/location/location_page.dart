import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/discovery_providers.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import 'location_controller.dart';

String addressLabel(AppLocalizations l, AddressLabel a) => switch (a) {
      AddressLabel.home => l.addressHome,
      AddressLabel.work => l.addressWork,
      AddressLabel.other => l.addressOther,
    };

IconData addressIcon(AddressLabel a) => switch (a) {
      AddressLabel.home => Icons.home_outlined,
      AddressLabel.work => Icons.work_outline,
      AddressLabel.other => Icons.place_outlined,
    };

/// Choose where to deliver: GPS, a map pin, or a saved address (wireframe 01, location sheet).
class LocationPage extends ConsumerStatefulWidget {
  const LocationPage({super.key});

  @override
  ConsumerState<LocationPage> createState() => _LocationPageState();
}

class _LocationPageState extends ConsumerState<LocationPage> {
  bool _busy = false;
  String? _message;
  bool _notServiceable = false;

  Future<void> _run(Future<DeliveryLocation?> Function() pick) async {
    final l = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _message = null;
      _notServiceable = false;
    });
    try {
      final loc = await pick();
      if (!mounted || loc == null) return;
      if (loc.serviceable) {
        context.go('/');
      } else {
        setState(() => _notServiceable = true);
      }
    } catch (_) {
      if (mounted) setState(() => _message = l.errorLoad);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<DeliveryLocation?> _gps() async {
    final l = AppLocalizations.of(context);
    final r = await ref.read(locationControllerProvider.notifier).useDeviceLocation();
    switch (r) {
      case Located():
        final s = ref.read(locationControllerProvider);
        return s is LocationSet ? s.location : null;
      case LocationServiceOff():
        setState(() => _message = l.locationOff);
      case LocationDenied():
        setState(() => _message = l.locationDenied);
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final addresses = ref.watch(addressesProvider);
    final canGoBack = ref.watch(deliveryPointProvider) != null && context.canPop();

    return Scaffold(
      backgroundColor: SanthaColors.white,
      appBar: AppBar(
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        automaticallyImplyLeading: canGoBack,
        title: Text(l.deliverTo),
      ),
      body: ListView(
        padding: const EdgeInsets.all(SanthaSpacing.s5),
        children: [
          Text(l.locationTitle, style: text.headlineSmall),
          const SizedBox(height: SanthaSpacing.s1),
          Text(l.locationSubtitle, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s5),
          SanthaButton(
            key: const ValueKey('use-gps'),
            label: _busy ? l.locating : l.useCurrentLocation,
            icon: Icons.my_location,
            loading: _busy,
            onPressed: () => _run(_gps),
          ),
          const SizedBox(height: SanthaSpacing.s3),
          SanthaButton(
            key: const ValueKey('pick-on-map'),
            label: l.pickOnMap,
            icon: Icons.map_outlined,
            variant: SanthaButtonVariant.outline,
            onPressed: _busy ? null : () => context.push('/location/pin'),
          ),
          if (_message != null) ...[
            const SizedBox(height: SanthaSpacing.s4),
            Semantics(liveRegion: true, child: Text(_message!, style: text.bodyMedium?.copyWith(color: SanthaColors.chilli))),
          ],
          if (_notServiceable) ...[const SizedBox(height: SanthaSpacing.s4), const NotServiceableCard()],
          const SizedBox(height: SanthaSpacing.s6),
          Text(l.savedAddresses, style: text.titleMedium),
          const SizedBox(height: SanthaSpacing.s2),
          switch (addresses) {
            AsyncData(:final value) when value.isEmpty => Text(l.noAddresses, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
            AsyncData(:final value) => Column(children: [
                for (final a in value)
                  AddressTile(address: a, onTap: _busy ? null : () => _run(() => ref.read(locationControllerProvider.notifier).useAddress(a))),
              ]),
            AsyncError() => ErrorView(onRetry: () => ref.invalidate(addressesProvider)),
            _ => const LoadingView(),
          },
        ],
      ),
    );
  }
}

class AddressTile extends StatelessWidget {
  const AddressTile({super.key, required this.address, this.onTap, this.trailing});
  final Address address;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final a = address;
    final lang = l.localeName;
    final area = a.microMarket == null ? l.notServiceableShort : (lang == 'te' ? a.microMarket!.nameTe : a.microMarket!.name);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      onTap: onTap,
      leading: CircleAvatar(backgroundColor: SanthaColors.indigo100, child: Icon(addressIcon(a.label), color: SanthaColors.indigo)),
      title: Row(children: [
        Text(a.name ?? addressLabel(l, a.label), style: text.titleSmall),
        if (a.isDefault) ...[const SizedBox(width: SanthaSpacing.s2), TrustBadge(label: l.defaultAddress, positive: false)],
      ]),
      subtitle: Text(
        '${a.line} · $area',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: text.bodySmall?.copyWith(color: a.serviceable ? SanthaColors.slate : SanthaColors.chilli),
      ),
      trailing: trailing,
    );
  }
}

class NotServiceableCard extends StatelessWidget {
  const NotServiceableCard({super.key, this.onTryAnother});
  final VoidCallback? onTryAnother;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Container(
      key: const ValueKey('not-serviceable'),
      padding: const EdgeInsets.all(SanthaSpacing.s5),
      decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.xl)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(l.notServiceableTitle, style: text.titleMedium?.copyWith(color: SanthaColors.indigo)),
        const SizedBox(height: SanthaSpacing.s1),
        Text(l.notServiceableBody, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
        if (onTryAnother != null) ...[
          const SizedBox(height: SanthaSpacing.s3),
          SanthaButton(label: l.tryAnotherAddress, expand: false, onPressed: onTryAnother),
        ],
      ]),
    );
  }
}

/// Saves an address at [point] (optional) and makes it the delivery location.
Future<DeliveryLocation> saveAddressAndUse(WidgetRef ref, AddressInput input) async {
  final a = await ref.read(addressApiProvider).create(input);
  ref.invalidate(addressesProvider);
  return ref.read(locationControllerProvider.notifier).useAddress(a);
}
