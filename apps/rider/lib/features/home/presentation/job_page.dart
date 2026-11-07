import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/rider_controller.dart';
import 'copy.dart';
import '../../../support.dart';

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

  /// [clearCode]: after pickup or delivery the code field is done; Arrived keeps what was typed (audit B6).
  Future<void> _run(Future<void> Function() fn, {bool clearCode = true}) async {
    final l = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
      if (clearCode) _code.clear();
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
        actions: [
          if (job.value case final j?)
            IconButton(
              key: const ValueKey('job-support'),
              tooltip: l.supportTitle,
              icon: const Icon(Icons.support_agent),
              onPressed: () => startSupportChat(context, ref, strings: supportStrings(l), topics: supportTopics, orderId: j.orderId, orderCode: j.code, initialTopic: 'delivery'),
            ),
        ],
      ),
      body: job.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(SanthaSpacing.s6),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(l.apiError(e), textAlign: TextAlign.center),
              const SizedBox(height: SanthaSpacing.s4),
              SanthaButton(key: const ValueKey('job-retry'), label: l.retry, onPressed: () => ref.invalidate(jobProvider(widget.id))),
            ]),
          ),
        ),
        data: (j) => ListView(padding: const EdgeInsets.all(SanthaSpacing.s4), children: [
          if (j.state == DeliveryState.delivered)
            ..._done(l)
          else if (j.state == DeliveryState.failed)
            ..._failed(l, j)
          else if (j.state == DeliveryState.pickedUp)
            ..._toCustomer(l, j)
          else
            ..._toStore(l, j),
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
        SanthaButton(key: const ValueKey('arrived'), label: l.arrived, variant: SanthaButtonVariant.outline, onPressed: _busy ? null : () => _run(ctl.arrived, clearCode: false)),
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
            : () {
                int? cash;
                if (j.codDuePaise > 0) {
                  cash = cashPaise(_cash.text);
                  // Unreadable cash is never sent as Rs 0 (audit B5).
                  if (cash == null) return setState(() => _error = l.cashInvalid);
                }
                _run(() => ctl.delivered(_code.text.trim(), cash));
              },
      ),
      const SizedBox(height: SanthaSpacing.s3),
      SanthaButton(
        key: const ValueKey('couldnt-deliver'),
        label: l.couldntDeliver,
        variant: SanthaButtonVariant.outline,
        onPressed: _busy ? null : () => _reportFailed(l, j),
      ),
    ];
  }

  /// Couldn't deliver (ADR-026): pick why, optionally say what happened.
  Future<void> _reportFailed(AppLocalizations l, Job j) async {
    final picked = await showModalBottomSheet<(FailedReason, String)>(context: context, isScrollControlled: true, builder: (_) => const _FailSheet());
    if (picked == null || !mounted) return;
    await _run(() => ref.read(jobProvider(widget.id).notifier).failed(picked.$1, picked.$2));
  }

  /// Waiting for support with the order in hand; the customer may still call back.
  List<Widget> _failed(AppLocalizations l, Job j) {
    final text = Theme.of(context).textTheme;
    final ctl = ref.read(jobProvider(widget.id).notifier);
    return [
      Container(
        key: const ValueKey('failed-panel'),
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.md)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.failedHeadline, style: text.titleMedium),
          if (j.failedReason != null) Text(l.failedReasonLine(l.failedReason(j.failedReason!)), key: const ValueKey('failed-reason'), style: text.bodyMedium),
          const SizedBox(height: SanthaSpacing.s2),
          Text(l.failedBody, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
        ]),
      ),
      const SizedBox(height: SanthaSpacing.s4),
      Text('#${j.code}${j.dropName == null ? '' : ' · ${j.dropName}'}', style: text.titleMedium),
      Text([j.dropLine, ?j.dropLandmark].join(', '), style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
      const SizedBox(height: SanthaSpacing.s3),
      SanthaButton(
        key: const ValueKey('call-customer'),
        label: l.callCustomer,
        variant: SanthaButtonVariant.outline,
        onPressed: () => ref.read(launcherProvider)(Uri.parse('tel:${j.callNumber}')),
      ),
      const SizedBox(height: SanthaSpacing.s3),
      SanthaButton(key: const ValueKey('deliver-now'), label: l.deliverNow, loading: _busy, onPressed: _busy ? null : () => _run(ctl.retry)),
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

/// Cash typed by the rider, in paise: "1,200", "₹ 1200.50" and "1200" all read; anything else is null.
int? cashPaise(String text) {
  final t = text.replaceAll(RegExp(r'[\s,₹]'), '');
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(t)) return null;
  return (double.parse(t) * 100).round();
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

class _FailSheet extends StatefulWidget {
  const _FailSheet();
  @override
  State<_FailSheet> createState() => _FailSheetState();
}

class _FailSheetState extends State<_FailSheet> {
  FailedReason? _reason;
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(SanthaSpacing.s4, SanthaSpacing.s4, SanthaSpacing.s4, MediaQuery.viewInsetsOf(context).bottom + SanthaSpacing.s4),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.failTitle, style: text.titleMedium),
            Text(l.failCallFirst, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
            RadioGroup<FailedReason>(
              groupValue: _reason,
              onChanged: (r) => setState(() => _reason = r),
              child: Column(children: [
                for (final r in FailedReason.values) RadioListTile<FailedReason>(key: ValueKey('fail-${r.wire}'), value: r, title: Text(l.failedReason(r))),
              ]),
            ),
            TextField(key: const ValueKey('fail-note'), controller: _note, maxLength: 300, maxLines: 2, decoration: InputDecoration(hintText: l.failNoteHint)),
            SanthaButton(
              key: const ValueKey('fail-report'),
              label: l.failReport,
              onPressed: _reason == null ? null : () => Navigator.pop(context, (_reason!, _note.text.trim())),
            ),
          ]),
        ),
      ),
    );
  }
}
