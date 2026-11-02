import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../l10n/gen/app_localizations.dart';

Duration? _noRetry(int retryCount, Object error) => null;

final complianceApiProvider = Provider<ComplianceApi>((ref) => ComplianceApi(ref.watch(apiClientProvider)));
final consentsProvider = FutureProvider.autoDispose<List<Consent>>(retry: _noRetry, (ref) => ref.watch(complianceApiProvider).consents());
final grievancesProvider = FutureProvider.autoDispose<List<Grievance>>(retry: _noRetry, (ref) => ref.watch(complianceApiProvider).grievances());

/// The login screen says "by continuing you agree to the Terms and Privacy notice"; after sign-in
/// this records that agreement against the notice versions in force (once per version, DPDP §6).
final consentSyncProvider = FutureProvider.autoDispose<void>(retry: _noRetry, (ref) async {
  final api = ref.watch(complianceApiProvider);
  final current = {for (final c in await api.consents()) c.purpose: c};
  for (final purpose in const ['terms', 'privacy']) {
    if (current[purpose]?.current != true || current[purpose]?.granted != true) await api.setConsent(purpose, true);
  }
});

/// Account → Privacy and help: marketing consent, download my data, delete my account, grievances.
class PrivacyHelpPage extends ConsumerStatefulWidget {
  const PrivacyHelpPage({super.key});

  @override
  ConsumerState<PrivacyHelpPage> createState() => _PrivacyHelpPageState();
}

class _PrivacyHelpPageState extends ConsumerState<PrivacyHelpPage> {
  String? _dataSummary;
  bool _busy = false;

  void _toast(String message) => (ScaffoldMessenger.of(context)..removeCurrentSnackBar()).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _download(AppLocalizations l) async {
    setState(() => _busy = true);
    try {
      final api = ref.read(complianceApiProvider);
      final req = await api.requestData('access');
      final export = await api.exportData(req.id);
      int count(String k) => (export[k] as List?)?.length ?? 0;
      setState(() => _dataSummary = l.dataSummary(count('addresses'), count('orders'), count('consents')));
      ref.read(analyticsProvider).track('data_export_requested', const {});
    } on ApiException catch (e) {
      _toast(e.code == 'ALREADY_EXISTS' ? l.requestOpen : l.errorGeneric);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(AppLocalizations l) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.deleteConfirmTitle),
        content: Text(l.deleteConfirmBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: SanthaColors.chilli),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l.deleteConfirm),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(complianceApiProvider).requestData('erasure');
      ref.read(analyticsProvider).track('account_deletion_requested', const {});
      _toast(l.deleteRequested);
    } on ApiException catch (e) {
      _toast(e.code == 'ALREADY_EXISTS' ? l.requestOpen : l.errorGeneric);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final consents = ref.watch(consentsProvider);
    final marketing = consents.value?.where((c) => c.purpose == 'marketing').firstOrNull?.granted;

    return Scaffold(
      appBar: AppBar(title: Text(l.privacyHelp)),
      body: ListView(padding: const EdgeInsets.all(SanthaSpacing.s5), children: [
        Text(l.privacyTitle, style: text.titleMedium),
        SwitchListTile(
          key: const ValueKey('marketing-consent'),
          contentPadding: EdgeInsets.zero,
          title: Text(l.marketingConsent),
          subtitle: Text(l.marketingConsentSub),
          value: marketing ?? false,
          onChanged: consents.hasValue
              ? (v) async {
                  await ref.read(complianceApiProvider).setConsent('marketing', v);
                  ref.read(analyticsProvider).track('consent_changed', {'purpose': 'marketing', 'granted': v});
                  ref.invalidate(consentsProvider);
                }
              : null,
        ),
        ListTile(
          key: const ValueKey('download-data'),
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.download_outlined),
          title: Text(l.downloadData),
          subtitle: _dataSummary == null ? null : Text(_dataSummary!, key: const ValueKey('data-summary')),
          onTap: _busy ? null : () => _download(l),
        ),
        ListTile(
          key: const ValueKey('delete-account'),
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.delete_outline, color: SanthaColors.chilli),
          title: Text(l.deleteAccount, style: const TextStyle(color: SanthaColors.chilli)),
          onTap: () => _delete(l),
        ),
        const Divider(height: SanthaSpacing.s6),
        Text(l.helpTitle, style: text.titleMedium),
        const SizedBox(height: SanthaSpacing.s2),
        const _GrievanceForm(),
        const SizedBox(height: SanthaSpacing.s4),
        switch (ref.watch(grievancesProvider)) {
          AsyncData(:final value) => Column(children: [
              for (final g in value)
                ListTile(
                  key: ValueKey('grievance-${g.id}'),
                  contentPadding: EdgeInsets.zero,
                  title: Text(g.description, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text(g.resolution == null ? _status(l, g.status) : '${_status(l, g.status)} · ${g.resolution}'),
                  
                ),
            ]),
          AsyncError() => ErrorView(onRetry: () => ref.invalidate(grievancesProvider)),
          _ => const LoadingView(),
        },
      ]),
    );
  }

  String _status(AppLocalizations l, String s) => switch (s) {
        'acknowledged' => l.grievanceAcknowledged,
        'resolved' => l.grievanceResolved,
        _ => l.grievanceOpen,
      };
}

class _GrievanceForm extends ConsumerStatefulWidget {
  const _GrievanceForm();

  @override
  ConsumerState<_GrievanceForm> createState() => _GrievanceFormState();
}

class _GrievanceFormState extends ConsumerState<_GrievanceForm> {
  final _text = TextEditingController();
  String _category = 'order';
  bool _sending = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send(AppLocalizations l) async {
    setState(() => _sending = true);
    try {
      await ref.read(complianceApiProvider).raiseGrievance(_category, _text.text.trim());
      ref.read(analyticsProvider).track('grievance_raised', {'category': _category});
      _text.clear();
      ref.invalidate(grievancesProvider);
      if (mounted) (ScaffoldMessenger.of(context)..removeCurrentSnackBar()).showSnackBar(SnackBar(content: Text(l.grievanceSent)));
    } on ApiException {
      if (mounted) (ScaffoldMessenger.of(context)..removeCurrentSnackBar()).showSnackBar(SnackBar(content: Text(l.errorGeneric)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final categories = {
      'order': l.catOrder,
      'payment': l.catPayment,
      'refund': l.catRefund,
      'account': l.catAccount,
      'privacy': l.catPrivacy,
      'other': l.catOther,
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(l.raiseGrievance, style: Theme.of(context).textTheme.titleSmall),
      const SizedBox(height: SanthaSpacing.s2),
      DropdownButtonFormField<String>(
        key: const ValueKey('grievance-category'),
        initialValue: _category,
        decoration: InputDecoration(labelText: l.grievanceCategory),
        items: [for (final e in categories.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
        onChanged: (v) => setState(() => _category = v ?? 'order'),
      ),
      const SizedBox(height: SanthaSpacing.s2),
      TextField(
        key: const ValueKey('grievance-text'),
        controller: _text,
        maxLines: 3,
        maxLength: 2000,
        decoration: InputDecoration(labelText: l.grievanceText),
        onChanged: (_) => setState(() {}),
      ),
      SanthaButton(
        label: l.grievanceSend,
        onPressed: _sending || _text.text.trim().length < 10 ? null : () => _send(l),
      ),
    ]);
  }
}
