import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/catalogue_controller.dart';
import 'catalogue_copy.dart';
import 'item_form_page.dart';

/// Whether to show the live camera. Tests and devices without a camera use typed entry only.
final scannerCameraProvider = Provider<bool>((ref) => true);

/// Barcode scan → master catalogue (FR-CAT-1): a hit opens the item form pre-filled (or the item
/// if the store already sells it); a miss opens the create-SKU form and queues the barcode for ops.
/// Built for scanning many products in a row ("50 barcodes in 10 minutes").
class ScanPage extends ConsumerStatefulWidget {
  const ScanPage({super.key});
  @override
  ConsumerState<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends ConsumerState<ScanPage> {
  final _manual = TextEditingController();
  bool _busy = false;
  String? _message;
  String? _lastCode;
  int _scanned = 0;

  @override
  void dispose() {
    _manual.dispose();
    super.dispose();
  }

  Future<void> _resolve(String raw) async {
    final code = raw.replaceAll(RegExp(r'\s'), '');
    if (_busy || code.isEmpty || code == _lastCode) return;
    final l = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _message = null;
      _lastCode = code;
    });
    final analytics = ref.read(analyticsProvider);
    try {
      final r = await ref.read(catalogueApiProvider).scan(code);
      analytics.track('barcode_scanned', {'result': r.fromOpenSource ? 'open_barcode' : 'master', 'already_listed': r.existingItemId != null});
      if (!mounted) return;
      setState(() => _scanned++);
      if (r.existingItemId != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.scanAlreadyListed)));
        await context.push('/catalogue/item/${r.existingItemId}');
      } else {
        await context.push('/catalogue/item/new', extra: ItemFormSeed(master: r.product));
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'BARCODE_UNKNOWN') {
        analytics.track('barcode_scanned', {'result': 'unknown'});
        setState(() => _scanned++);
        await context.push('/catalogue/item/new', extra: ItemFormSeed(unknownBarcode: code));
      } else {
        setState(() => _message = e.code == 'VALIDATION_FAILED' ? l.scanInvalid : l.catalogueError(e, english: false));
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _lastCode = null;
        });
        if (_message == null) _manual.clear(); // ready for the next product
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final camera = ref.watch(scannerCameraProvider);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(l.scanTitle), actions: [
        if (_scanned > 0) Center(child: Padding(padding: const EdgeInsets.only(right: SanthaSpacing.s4), child: Text(l.scanCount(_scanned)))),
      ]),
      body: ListView(
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        children: [
          if (camera)
            ClipRRect(
              borderRadius: BorderRadius.circular(SanthaRadius.lg),
              child: AspectRatio(
                aspectRatio: 1,
                child: MobileScanner(
                  onDetect: (capture) {
                    final v = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
                    if (v != null) _resolve(v);
                  },
                  errorBuilder: (context, error) => ColoredBox(
                    color: SanthaColors.sky,
                    child: Center(child: Padding(padding: const EdgeInsets.all(SanthaSpacing.s6), child: Text(l.scanCameraOff, textAlign: TextAlign.center))),
                  ),
                ),
              ),
            ),
          const SizedBox(height: SanthaSpacing.s3),
          Text(l.scanHint, style: text.bodyMedium?.copyWith(color: SanthaColors.slate), textAlign: TextAlign.center),
          const SizedBox(height: SanthaSpacing.s6),
          Row(children: [
            Expanded(
              child: TextField(
                key: const ValueKey('scan-manual'),
                controller: _manual,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(14)],
                decoration: InputDecoration(labelText: l.scanManual),
                onSubmitted: _resolve,
              ),
            ),
            const SizedBox(width: SanthaSpacing.s3),
            FilledButton(
              key: const ValueKey('scan-find'),
              style: FilledButton.styleFrom(minimumSize: const Size(96, 48)), // the theme's buttons are full-width
              onPressed: _busy ? null : () => _resolve(_manual.text), child: Text(l.scanFind)),
          ]),
          if (_busy) const Padding(padding: EdgeInsets.only(top: SanthaSpacing.s4), child: LinearProgressIndicator()),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(top: SanthaSpacing.s4),
              child: Text(_message!, key: const ValueKey('scan-message'), style: const TextStyle(color: SanthaColors.chilli)),
            ),
        ],
      ),
    );
  }
}
