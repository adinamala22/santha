import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' as fm;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:santha_api/santha_api.dart' hide LatLng;
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/format.dart';
import '../../data/order_providers.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';

const _tiles = String.fromEnvironment('MAP_TILES_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');

/// Map tiles off in widget tests (no network); a plain panel stands in.
final trackingMapEnabledProvider = Provider<bool>((ref) => true);

/// Opens tel: links. Tests override it.
final dialerProvider = Provider<Future<void> Function(String number)>(
  (ref) => (n) async {
    await launchUrl(Uri.parse('tel:$n'));
  },
);

/// Live tracking of an accepted order (M6). Null until the store accepts (404).
final trackingProvider = AsyncNotifierProvider.autoDispose.family<TrackingController, Tracking?, String>(TrackingController.new);

class TrackingController extends AsyncNotifier<Tracking?> {
  TrackingController(this.orderId);
  final String orderId;

  @override
  Future<Tracking?> build() async {
    // Each courier fix moves the marker and the ETA without a refetch.
    ref.listen(realtimeEventsProvider, (_, next) {
      final e = next.value;
      if (e == null || e.orderId != orderId) return;
      if (e.name == 'order.location') {
        final cur = state.value;
        final lat = (e.data['lat'] as num?)?.toDouble();
        final lng = (e.data['lng'] as num?)?.toDouble();
        if (cur != null && lat != null && lng != null) {
          state = AsyncData(cur.withLocation(Point(lat, lng), e.data['etaAt'] == null ? null : DateTime.parse(e.data['etaAt'] as String)));
        }
      } else if (e.name == 'order.updated') {
        ref.invalidateSelf();
      }
    });
    try {
      return await ref.read(checkoutApiProvider).tracking(orderId);
    } on ApiException catch (e) {
      if (e.code == 'NOT_FOUND') return null;
      rethrow;
    }
  }
}

/// Tracking panel (wireframe consumer/06-tracking): map, ETA vs promise, the courier with a masked
/// call and the delivery OTP; while no courier is found, the delay notice and the refund cancel.
class TrackingSection extends ConsumerWidget {
  const TrackingSection({super.key, required this.orderId, required this.storeName});
  final String orderId;
  final String storeName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(trackingProvider(orderId)).value;
    if (t == null || t.state == DeliveryState.delivered || t.state == DeliveryState.cancelled) return const SizedBox.shrink();
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Column(
      key: const ValueKey('tracking'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Map(tracking: t),
        const SizedBox(height: SanthaSpacing.s3),
        if (t.state == DeliveryState.searching) ...[
          _Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.canCancelNoCourier ? l.findingCourierLate : l.findingCourier, key: const ValueKey('finding-courier'), style: text.bodyLarge),
                const SizedBox(height: SanthaSpacing.s1),
                Text(l.promisedBy(istClock(t.etaAt ?? t.promisedAt)), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                if (t.canCancelNoCourier) ...[
                  const SizedBox(height: SanthaSpacing.s3),
                  SanthaButton(
                    key: const ValueKey('cancel-no-courier'),
                    label: l.cancelFullRefund,
                    variant: SanthaButtonVariant.outline,
                    onPressed: () async {
                      await ref.read(checkoutApiProvider).cancelNoCourier(orderId);
                      ref.read(analyticsProvider).track('order_cancelled', {'order_id': orderId, 'reason': 'no_courier'});
                      ref.invalidate(orderProvider(orderId));
                      ref.invalidate(ordersProvider);
                      ref.invalidate(walletProvider);
                      ref.invalidate(trackingProvider(orderId));
                    },
                  ),
                ],
              ],
            ),
          ),
        ] else ...[
          _EtaCard(tracking: t),
          const SizedBox(height: SanthaSpacing.s3),
          if (t.courier != null) _CourierCard(tracking: t, storeName: storeName),
        ],
      ],
    );
  }
}

class _Map extends ConsumerWidget {
  const _Map({required this.tracking});
  final Tracking tracking;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final t = tracking;
    LatLng ll(Point p) => LatLng(p.lat, p.lng);
    final points = [ll(t.store), ll(t.drop), if (t.courierLocation != null) ll(t.courierLocation!)];
    Widget marker(IconData icon, Color color) => Container(
      decoration: BoxDecoration(
        color: SanthaColors.white,
        shape: BoxShape.circle,
        border: Border.all(color: color, width: 2),
      ),
      padding: const EdgeInsets.all(SanthaSpacing.s1),
      child: Icon(icon, size: 18, color: color),
    );
    return Semantics(
      label: l.trackingMapLabel,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(SanthaRadius.lg),
        child: SizedBox(
          height: 220,
          child: !ref.watch(trackingMapEnabledProvider)
              ? Container(key: const ValueKey('tracking-map'), color: SanthaColors.sky)
              : fm.FlutterMap(
                  key: const ValueKey('tracking-map'),
                  options: fm.MapOptions(
                    initialCameraFit: fm.CameraFit.bounds(bounds: fm.LatLngBounds.fromPoints(points), padding: const EdgeInsets.all(40), maxZoom: 17),
                    interactionOptions: const fm.InteractionOptions(flags: fm.InteractiveFlag.pinchZoom | fm.InteractiveFlag.drag),
                  ),
                  children: [
                    fm.TileLayer(urlTemplate: _tiles, userAgentPackageName: 'app.santha.consumer'),
                    fm.MarkerLayer(
                      markers: [
                        fm.Marker(point: ll(t.store), width: 34, height: 34, child: marker(Icons.storefront, SanthaColors.indigo)),
                        fm.Marker(point: ll(t.drop), width: 34, height: 34, child: marker(Icons.home, SanthaColors.leaf)),
                        if (t.courierLocation != null)
                          fm.Marker(point: ll(t.courierLocation!), width: 34, height: 34, child: marker(Icons.delivery_dining, SanthaColors.marigold600)),
                      ],
                    ),
                    const fm.SimpleAttributionWidget(source: Text('OpenStreetMap contributors')),
                  ],
                ),
        ),
      ),
    );
  }
}

class _EtaCard extends StatelessWidget {
  const _EtaCard({required this.tracking});
  final Tracking tracking;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final eta = tracking.etaAt ?? tracking.promisedAt;
    final mins = eta.difference(DateTime.now()).inMinutes;
    final late = eta.isAfter(tracking.promisedAt.add(const Duration(minutes: 1)));
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(mins <= 1 ? l.arrivingNow : l.arrivingIn(mins), key: const ValueKey('eta'), style: text.headlineSmall),
          Text(
            late ? l.lateBy(istClock(tracking.promisedAt)) : l.onTimeBy(istClock(tracking.promisedAt)),
            key: const ValueKey('eta-promise'),
            style: text.bodyMedium?.copyWith(color: late ? SanthaColors.marigold600 : SanthaColors.leaf),
          ),
        ],
      ),
    );
  }
}

class _CourierCard extends ConsumerWidget {
  const _CourierCard({required this.tracking, required this.storeName});
  final Tracking tracking;
  final String storeName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = tracking.courier!;
    final who = switch (c.kind) {
      CourierKind.staff => l.courierStaff(c.name, storeName),
      CourierKind.owner => l.courierOwner(storeName),
      CourierKind.rider => l.courierRider(c.name),
      CourierKind.tpl => l.courierPartner,
    };
    return _Panel(
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: SanthaColors.indigo100,
            child: Icon(Icons.delivery_dining, color: SanthaColors.indigo),
          ),
          const SizedBox(width: SanthaSpacing.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(who, key: const ValueKey('courier'), style: text.titleSmall),
                if (tracking.deliveryOtp != null) ...[
                  Text(
                    l.deliveryOtp(tracking.deliveryOtp!.split('').join(' ')),
                    key: const ValueKey('delivery-otp'),
                    style: text.titleMedium?.copyWith(color: SanthaColors.indigo),
                  ),
                  Text(l.deliveryOtpHint, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                ],
              ],
            ),
          ),
          // Full-width button by default; give it a fixed width inside the row.
          SizedBox(
            width: 104,
            child: SanthaButton(
              key: const ValueKey('call-courier'),
              label: l.callCourier,
              variant: SanthaButtonVariant.outline,
              onPressed: () => ref.read(dialerProvider)(c.callNumber),
            ),
          ),
        ],
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(SanthaSpacing.s4),
    decoration: BoxDecoration(
      color: SanthaColors.white,
      borderRadius: BorderRadius.circular(SanthaRadius.lg),
      border: Border.all(color: SanthaColors.indigo100, width: 1.5),
    ),
    child: child,
  );
}
