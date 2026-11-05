import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/rider_controller.dart';
import 'copy.dart';

/// Opens a URL outside the app (maps navigation, phone dialer). Tests override it.
final launcherProvider = Provider<Future<void> Function(Uri)>((ref) => (uri) async {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    });

/// Job screen (wireframe rider/02-delivery): to the store (arrived, pickup code), then to the customer
/// (address, masked call, OTP, cash for COD) and Mark delivered. Navigation hands off to Google Maps.
class JobPage extends ConsumerStatefulWidget {
  const JobPage({super.key, required this.id});
  final String id;

  @override
  ConsumerState<JobPage> createState() => _JobPageState();
}

class _JobPageState extends ConsumerState<JobPage> {
  final _code = TextEditingController();
  final _cash = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _cashFor;

  @override
  void dispose() {
    _code.dispose();
    _cash.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() fn) async {
    final l = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
      _code.clear();
    } catch (e) {
      setState(() => _error = l.apiError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final job = ref.watch(jobProvider(widget.id));
    return Scaffold(
      appBar: AppBar(
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        title: Text(job.value == null ? '' : l.orderCode(job.value!.code)),
      ),
      body: job.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(l.apiError(e))),
        data: (j) => ListView(padding: const EdgeInsets.all(SanthaSpacing.s4), children: [
          if (j.state == DeliveryState.delivered) ..._done(l) else if (j.state == DeliveryState.pickedUp) ..._toCustomer(l, j) else ..._toStore(l, j),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s3), child: Text(_error!, key: const ValueKey('job-error'), style: const TextStyle(color: SanthaColors.chilli))),
        ]),
      ),
    );
  }

  Future<void> _navigate(Point p) => ref.read(launcherProvider)(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=two-wheeler'));

  List<Widget> _toStore(AppLocalizations l, Job j) {
    final text = Theme.of(context).textTheme;
    final ctl = ref.read(jobProvider(widget.id).notifier);
    return [
      Text(l.stepToStore, style: text.titleMedium?.copyWith(color: SanthaColors.slate)),
      const SizedBox(height: SanthaSpacing.s2),
      Card(
        child: ListTile(
          title: Text(j.storeName, style: text.titleLarge),
          subtitle: Text([?j.storeLine, l.itemsCount(j.itemCount)].join(' · ')),
          trailing: IconButton(tooltip: l.navigate, icon: const Icon(Icons.navigation, color: SanthaColors.indigo), onPressed: () => _navigate(j.store)),
        ),
      ),
      const SizedBox(height: SanthaSpacing.s3),
      Text(j.ready ? l.orderReady : l.waitingReady, key: const ValueKey('ready-state'), style: TextStyle(color: j.ready ? SanthaColors.leaf : SanthaColors.marigold600)),
      const SizedBox(height: SanthaSpacing.s3),
      if (j.arrivedAt == null)
        SanthaButton(key: const ValueKey('arrived'), label: l.arrived, variant: SanthaButtonVariant.outline, onPressed: _busy ? null : () => _run(ctl.arrived)),
      const SizedBox(height: SanthaSpacing.s3),
      _CodeField(key: const ValueKey('pickup-code'), controller: _code, label: l.pickupCodeLabel),
      const SizedBox(height: SanthaSpacing.s3),
      SanthaButton(
        key: const ValueKey('picked-up'),
        label: l.pickedUp,
        loading: _busy,
        onPressed: _busy ? null : () => _run(() => ctl.pickedUp(_code.text.trim())),
      ),
    ];
  }

  List<Widget> _toCustomer(AppLocalizations l, Job j) {
    final text = Theme.of(context).textTheme;
    final ctl = ref.read(jobProvider(widget.id).notifier);
    // Fill in the amount due once per job; after that the field is the rider's (they may clear it to retype).
    if (j.codDuePaise > 0 && _cashFor != j.id) {
      _cashFor = j.id;
      _cash.text = (j.codDuePaise / 100).toStringAsFixed(j.codDuePaise % 100 == 0 ? 0 : 2);
    }
    return [
      Text(l.stepToCustomer, style: text.titleMedium?.copyWith(color: SanthaColors.slate)),
      const SizedBox(height: SanthaSpacing.s2),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('#${j.code}${j.dropName == null ? '' : ' · ${j.dropName}'}', style: text.titleLarge),
            const SizedBox(height: SanthaSpacing.s1),
            Text([j.dropLine, ?j.dropLandmark].join(', '), key: const ValueKey('drop-address'), style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
            if (j.instructions != null) Text(l.noteLabel(j.instructions!), style: text.bodyMedium?.copyWith(color: SanthaColors.indigo)),
            const SizedBox(height: SanthaSpacing.s3),
            Row(children: [
              Expanded(
                child: SanthaButton(
                  key: const ValueKey('call-customer'),
                  label: l.callCustomer,
                  variant: SanthaButtonVariant.outline,
                  onPressed: () => ref.read(launcherProvider)(Uri.parse('tel:${j.callNumber}')),
                ),
              ),
              const SizedBox(width: SanthaSpacing.s3),
              Expanded(child: SanthaButton(key: const ValueKey('navigate-drop'), label: l.navigate, variant: SanthaButtonVariant.outline, onPressed: () => _navigate(j.drop))),
            ]),
          ]),
        ),
      ),
      const SizedBox(height: SanthaSpacing.s4),
      _CodeField(key: const ValueKey('delivery-otp'), controller: _code, label: l.otpLabel),
      Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s1), child: Text(l.otpHint, style: text.bodySmall?.copyWith(color: SanthaColors.slate))),
      const SizedBox(height: SanthaSpacing.s4),
      Container(
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.md)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(j.codDuePaise > 0 ? l.collectCod(rupees(j.codDuePaise)) : l.prepaid, key: const ValueKey('cod'), style: text.titleSmall),
          if (j.codDuePaise > 0)
            TextField(
              key: const ValueKey('cash-collected'),
              controller: _cash,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l.cashCollected),
            ),
        ]),
      ),
      const SizedBox(height: SanthaSpacing.s6),
      SanthaButton(
        key: const ValueKey('mark-delivered'),
        label: l.markDelivered,
        loading: _busy,
        onPressed: _busy
            ? null
            : () => _run(() => ctl.delivered(_code.text.trim(), j.codDuePaise > 0 ? ((double.tryParse(_cash.text.trim()) ?? 0) * 100).round() : null)),
      ),
    ];
  }

  List<Widget> _done(AppLocalizations l) => [
        const SizedBox(height: SanthaSpacing.s10),
        const Icon(Icons.check_circle, size: 72, color: SanthaColors.leaf),
        const SizedBox(height: SanthaSpacing.s4),
        Text(l.deliveredDone, key: const ValueKey('delivered-done'), textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: SanthaSpacing.s6),
        SanthaButton(label: l.backHome, onPressed: () => context.canPop() ? context.pop() : context.go('/')),
      ];
}

class _CodeField extends StatelessWidget {
  const _CodeField({super.key, required this.controller, required this.label});
  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        maxLength: 4,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        style: Theme.of(context).textTheme.headlineSmall?.copyWith(letterSpacing: 12),
        decoration: InputDecoration(labelText: label, counterText: ''),
      );
}
