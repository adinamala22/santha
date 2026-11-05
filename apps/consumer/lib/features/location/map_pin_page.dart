import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' as fm;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' as ll;
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import 'location_controller.dart';
import 'location_page.dart';

/// Raster tiles: OpenStreetMap in dev (low volume, attribution shown); production points
/// MAP_TILES_URL at Google Maps / MapTiler tiles (ADR-007, ADR-009).
const _tiles = String.fromEnvironment('MAP_TILES_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
const _nellore = ll.LatLng(14.4426, 79.9865);

/// Manual pin: drag the map under a fixed pin, then optionally save it as an address. Opened from
/// "Use current location" with the GPS [fix]: the pin starts there, the accuracy circle shows how sure
/// the phone is, and the customer moves the pin to the door. "Locate me" fetches a fresh fix.
class MapPinPage extends ConsumerStatefulWidget {
  const MapPinPage({super.key, this.fix, this.returnOnDone = false});
  final Located? fix;

  /// Go back to the page that opened it (checkout, Account) with the saved location, instead of Home.
  final bool returnOnDone;

  @override
  ConsumerState<MapPinPage> createState() => _MapPinPageState();
}

class _MapPinPageState extends ConsumerState<MapPinPage> {
  final _map = fm.MapController();
  late Located? _fix = widget.fix;
  bool _locating = false;
  String? _locateError;

  Future<void> _locateMe() async {
    final l = AppLocalizations.of(context);
    setState(() {
      _locating = true;
      _locateError = null;
    });
    final r = await ref.read(locationControllerProvider.notifier).locateDevice();
    if (!mounted) return;
    setState(() {
      _locating = false;
      switch (r) {
        case Located():
          _fix = r;
          _map.move(ll.LatLng(r.point.lat, r.point.lng), 18);
        case LocationServiceOff():
          _locateError = l.locationOff;
        case LocationDenied():
          _locateError = l.locationDenied;
        case LocationUnavailable():
          _locateError = l.locationUnavailable;
      }
    });
  }
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
          : await ref.read(locationControllerProvider.notifier).set(_centre, _fix != null ? LocationSource.gps : LocationSource.pin);
      if (!mounted) return;
      if (widget.returnOnDone && context.canPop()) {
        context.pop(loc);
      } else if (loc.serviceable) {
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
    final current = widget.fix?.point ?? ref.watch(deliveryPointProvider)?.point;
    final start = current == null ? _nellore : ll.LatLng(current.lat, current.lng);
    final fix = _fix;

    return Scaffold(
      appBar: AppBar(backgroundColor: SanthaColors.indigo, foregroundColor: SanthaColors.white, title: Text(l.pinTitle)),
      body: Column(children: [
        Expanded(
          child: Stack(alignment: Alignment.center, children: [
            Semantics(
              label: l.pinMapLabel,
              child: fm.FlutterMap(
                mapController: _map,
                options: fm.MapOptions(initialCenter: start, initialZoom: widget.fix != null ? 18 : 17, minZoom: 12, maxZoom: 19),
                children: [
                  fm.TileLayer(urlTemplate: _tiles, userAgentPackageName: 'app.santha.consumer'),
                  if (fix?.accuracyM case final acc?)
                    fm.CircleLayer(circles: [
                      fm.CircleMarker(
                        point: ll.LatLng(fix!.point.lat, fix.point.lng),
                        radius: acc,
                        useRadiusInMeter: true,
                        color: SanthaColors.indigo.withValues(alpha: 0.12),
                        borderColor: SanthaColors.indigo,
                        borderStrokeWidth: 1,
                      ),
                    ]),
                  // Tile attribution (required by the tile licence); one line that never overflows, even at large text sizes.
                  const Align(
                    alignment: Alignment.bottomLeft,
                    child: ColoredBox(
                      color: Color(0xCCFFFFFF),
                      child: Padding(
                        padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        child: Text('© OpenStreetMap contributors', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: SanthaColors.slate)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // The pin's tip (y = 22 of the 24-unit glyph) sits exactly on the map centre.
            const IgnorePointer(
              child: Padding(
                padding: EdgeInsets.only(bottom: 40),
                child: Icon(Icons.location_on, size: 48, color: SanthaColors.marigold),
              ),
            ),
            Positioned(
              right: SanthaSpacing.s4,
              bottom: SanthaSpacing.s4,
              child: FloatingActionButton.small(
                key: const ValueKey('locate-me'),
                heroTag: 'locate-me',
                tooltip: l.locateMe,
                backgroundColor: SanthaColors.white,
                foregroundColor: SanthaColors.indigo,
                onPressed: _locating ? null : _locateMe,
                child: _locating ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.my_location),
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
                if (fix != null && !fix.precise)
                  Text(l.gpsApproximate, key: const ValueKey('gps-approximate'), style: text.bodySmall?.copyWith(color: SanthaColors.chilli))
                else if (fix?.accuracyM case final acc?)
                  Text(
                    l.gpsAccuracy(acc.round()),
                    key: const ValueKey('gps-accuracy'),
                    style: text.bodySmall?.copyWith(color: acc > Located.goodAccuracyM ? SanthaColors.chilli : SanthaColors.slate),
                  )
                else
                  Text(l.pinHint, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                if (_locateError != null) Text(_locateError!, style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
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
                if (!widget.returnOnDone) const SizedBox(height: SanthaSpacing.s2),
                if (!widget.returnOnDone) SanthaButton(label: l.skipSaving, variant: SanthaButtonVariant.outline, onPressed: _busy ? null : () => _confirm(save: false)),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}
