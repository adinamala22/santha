import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/catalogue_controller.dart';
import 'catalogue_copy.dart';

/// Bulk CSV import (FR-CAT-4): paste a list (copied from Sheets/Excel or WhatsApp), check it
/// (rejected rows listed with reasons), then add the items. Long lists go through ops (assisted).
class ImportPage extends ConsumerStatefulWidget {
  const ImportPage({super.key});
  @override
  ConsumerState<ImportPage> createState() => _ImportPageState();
}

class _ImportPageState extends ConsumerState<ImportPage> {
  final _csv = TextEditingController(text: 'name,category,size,unit,qty,price,mrp\n');
  ImportReport? _report;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _csv.dispose();
    super.dispose();
  }

  Future<void> _run({required bool dryRun}) async {
    final l = AppLocalizations.of(context);
    final english = Localizations.localeOf(context).languageCode == 'en';
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(catalogueApiProvider).importCsv(_csv.text, dryRun: dryRun);
      setState(() => _report = r);
      if (!dryRun) {
        ref.read(analyticsProvider).track('catalogue_imported', {'created': r.created, 'rejected': r.rejected.length});
        await ref.read(catalogueProvider.notifier).reload();
      }
    } catch (e) {
      setState(() => _error = l.catalogueError(e, english: english));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final r = _report;
    return Scaffold(
      appBar: AppBar(title: Text(l.importTitle)),
      body: ListView(
        padding: const EdgeInsets.all(SanthaSpacing.s6),
        children: [
          Text(l.importSub, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s4),
          TextField(
            key: const ValueKey('import-text'),
            controller: _csv,
            minLines: 6,
            maxLines: 14,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            decoration: InputDecoration(labelText: l.importPaste, alignLabelWithHint: true),
            onChanged: (_) => setState(() => _report = null),
          ),
          const SizedBox(height: SanthaSpacing.s4),
          if (_error != null) Text(_error!, key: const ValueKey('import-error'), style: const TextStyle(color: SanthaColors.chilli)),
          if (r != null && r.dryRun) ...[
            Text(l.importReady(r.ready.length), key: const ValueKey('import-ready'), style: text.titleMedium?.copyWith(color: SanthaColors.leaf)),
            if (r.rejected.isNotEmpty) ...[
              const SizedBox(height: SanthaSpacing.s2),
              Text(l.importRejected(r.rejected.length), style: text.titleMedium?.copyWith(color: SanthaColors.chilli)),
              for (final row in r.rejected) Text(l.importLine(row.line, row.reasons.join('; ')), style: text.bodySmall),
            ],
          ],
          if (r != null && !r.dryRun) ...[
            Text(l.importDone(r.created), key: const ValueKey('import-done'), style: text.titleMedium?.copyWith(color: SanthaColors.leaf)),
            if (r.held > 0) Text(l.importHeld(r.held), style: text.bodySmall),
          ],
          const SizedBox(height: SanthaSpacing.s6),
          if (r != null && r.dryRun && r.ready.isNotEmpty)
            SanthaButton(key: const ValueKey('import-now'), label: l.importNow(r.ready.length), loading: _busy, onPressed: _busy ? null : () => _run(dryRun: false))
          else
            SanthaButton(key: const ValueKey('import-check'), label: l.importCheck, loading: _busy, onPressed: _busy ? null : () => _run(dryRun: true)),
        ],
      ),
    );
  }
}
