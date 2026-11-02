import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' as fm;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../l10n/gen/app_localizations.dart';
import 'location_controller.dart';
import 'location_page.dart';

/// Raster tiles: OpenStreetMap in dev (low volume, attribution shown); production points
/// MAP_TILES_URL at Google Maps / MapTiler tiles (ADR-007, ADR-009).
const _tiles = String.fromEnvironment('MAP_TILES_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
const _nellore = ll.LatLng(14.4426, 79.9865);

/// Manual pin: drag the map under a fixed pin, then optionally save it as an address.
class MapPinPage extends ConsumerStatefulWidget {
  const MapPinPage({super.key});

  @override
  ConsumerState<MapPinPage> createState() => _MapPinPageState();
}

class _MapPinPageState extends ConsumerState<MapPinPage> {
  final _map = fm.MapController();
  final _form = GlobalKey<FormState>();
  final _line = TextEditingController();
  final _landmark = TextEditingController();
  var _label = AddressLabel.home;
  bool _busy = false;
  bool _notServiceable = false;
  String? _error;

  @override
  void dispose() {
    _line.dispose();
    _landmark.dispose();
    super.dispose();
  }

  LatLng get _centre {
    final c = _map.camera.center;
    return LatLng(c.latitude, c.longitude);
  }

  Future<void> _confirm({required bool save}) async {
    final l = AppLocalizations.of(context);
    if (save && !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
      _notServiceable = false;
    });
    try {
      final loc = save
          ? await saveAddressAndUse(ref, AddressInput(label: _label, line: _line.text.trim(), landmark: _landmark.text.trim(), location: _centre))
          : await ref.read(locationControllerProvider.notifier).set(_centre, LocationSource.pin);
      if (!mounted) return;
      if (loc.serviceable) {
        context.go('/');
      } else {
        setState(() => _notServiceable = true);
      }
    } catch (_) {
      if (mounted) setState(() => _error = l.errorLoad);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final current = ref.watch(deliveryPointProvider)?.point;
    final start = current == null ? _nellore : ll.LatLng(current.lat, current.lng);

    return Scaffold(
      appBar: AppBar(backgroundColor: SanthaColors.indigo, foregroundColor: SanthaColors.white, title: Text(l.pinTitle)),
      body: Column(children: [
        Expanded(
          child: Stack(alignment: Alignment.center, children: [
            Semantics(
              label: l.pinMapLabel,
              child: fm.FlutterMap(
                mapController: _map,
                options: fm.MapOptions(initialCenter: start, initialZoom: 17, minZoom: 12, maxZoom: 19),
                children: [
                  fm.TileLayer(urlTemplate: _tiles, userAgentPackageName: 'app.santha.consumer'),
                  const fm.SimpleAttributionWidget(source: Text('OpenStreetMap contributors')),
                ],
              ),
            ),
            const IgnorePointer(
              child: Padding(
                padding: EdgeInsets.only(bottom: 40),
                child: Icon(Icons.location_on, size: 48, color: SanthaColors.marigold),
              ),
            ),
          ]),
        ),
        SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(SanthaSpacing.s4),
            child: Form(
              key: _form,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(l.pinHint, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                const SizedBox(height: SanthaSpacing.s3),
                Text(l.saveAddressTitle, style: text.titleSmall),
                const SizedBox(height: SanthaSpacing.s2),
                Wrap(spacing: SanthaSpacing.s2, children: [
                  for (final a in AddressLabel.values)
                    ChoiceChip(label: Text(addressLabel(l, a)), selected: _label == a, onSelected: (_) => setState(() => _label = a)),
                ]),
                const SizedBox(height: SanthaSpacing.s2),
                TextFormField(
                  key: const ValueKey('address-line'),
                  controller: _line,
                  decoration: InputDecoration(labelText: l.addressLine),
                  validator: (v) => (v ?? '').trim().length < 5 ? l.addressLineError : null,
                ),
                const SizedBox(height: SanthaSpacing.s2),
                TextFormField(controller: _landmark, decoration: InputDecoration(labelText: l.addressLandmark)),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s2), child: Text(_error!, style: text.bodySmall?.copyWith(color: SanthaColors.chilli))),
                if (_notServiceable) const Padding(padding: EdgeInsets.only(top: SanthaSpacing.s3), child: NotServiceableCard()),
                const SizedBox(height: SanthaSpacing.s3),
                SanthaButton(label: l.saveAndContinue, loading: _busy, onPressed: () => _confirm(save: true)),
                const SizedBox(height: SanthaSpacing.s2),
                SanthaButton(label: l.skipSaving, variant: SanthaButtonVariant.outline, onPressed: _busy ? null : () => _confirm(save: false)),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}
