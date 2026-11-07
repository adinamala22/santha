import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../l10n/gen/app_localizations.dart';
import '../../support.dart';
import '../home/data/rider_controller.dart';
import '../home/presentation/copy.dart';

/// Sign-up details and checks (ADR-029). Refreshed after every step.
final riderOnboardingProvider = FutureProvider.autoDispose<RiderOnboarding>((ref) => ref.watch(riderApiProvider).onboarding());

/// Shown in place of the home until ops approve the rider: the four steps, then "being checked",
/// the reason after a rejection, or "paused" (rider audit B2).
class RiderOnboardingView extends ConsumerWidget {
  const RiderOnboardingView({super.key, required this.home});
  final RiderHome home;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    if (home.status == RiderStatus.suspended) {
      return _Notice(
        key: const ValueKey('rider-suspended'),
        icon: Icons.pause_circle,
        title: l.onbSuspendedTitle,
        body: [?home.statusNote, l.onbSuspendedBody].join('\n\n'),
        action: SanthaButton(
          key: const ValueKey('suspended-support'),
          label: l.supportTitle,
          variant: SanthaButtonVariant.outline,
          onPressed: () => startSupportChat(context, ref, strings: supportStrings(l), topics: supportTopics, initialTopic: 'account'),
        ),
      );
    }
    if (home.status == RiderStatus.submitted) {
      return _Notice(key: const ValueKey('rider-submitted'), icon: Icons.hourglass_top, title: l.onbSubmittedTitle, body: l.onbSubmittedBody);
    }
    final onb = ref.watch(riderOnboardingProvider);
    return onb.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s6),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(l.apiError(e), textAlign: TextAlign.center),
            const SizedBox(height: SanthaSpacing.s4),
            SanthaButton(label: l.retry, onPressed: () => ref.invalidate(riderOnboardingProvider)),
          ]),
        ),
      ),
      data: (o) => ListView(
        key: const ValueKey('rider-onboarding'),
        padding: const EdgeInsets.all(SanthaSpacing.s4),
        children: [
          Text(l.onbTitle, style: text.headlineSmall),
          const SizedBox(height: SanthaSpacing.s2),
          Text(l.onbIntro, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          if (o.status == RiderStatus.rejected) ...[
            const SizedBox(height: SanthaSpacing.s4),
            Container(
              key: const ValueKey('rider-rejected'),
              padding: const EdgeInsets.all(SanthaSpacing.s4),
              decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.md)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(l.onbRejectedTitle, style: text.titleSmall),
                if (o.statusNote != null) Text(l.failedReasonLine(o.statusNote!), style: text.bodyMedium),
              ]),
            ),
          ],
          const SizedBox(height: SanthaSpacing.s4),
          _StepTile(stepKey: 'profile', title: l.onbStepProfile, subtitle: o.done('profile') ? '${o.name} · ${l.vehicleName(o.vehicle)}${o.vehicleNumber == null ? '' : ' · ${o.vehicleNumber}'}' : null, o: o, onTap: () => _open(context, ref, _ProfileSheet(o: o))),
          _StepTile(
            stepKey: 'selfie',
            title: l.onbStepSelfie,
            subtitle: o.hasSelfie ? l.onbPhotoAdded : l.onbSelfieHint,
            o: o,
            onTap: () => _takePhoto(context, ref, 'selfie', front: true),
          ),
          _StepTile(stepKey: 'identity', title: l.onbStepIdentity, subtitle: (o.check(KycKind.aadhaar) ?? o.check(KycKind.pan))?.display, check: _identityCheck(o), o: o, onTap: () => _open(context, ref, const _IdentitySheet())),
          if (o.vehicle.needsLicence)
            _StepTile(stepKey: 'driving_licence', title: l.onbStepLicence, subtitle: [?o.check(KycKind.drivingLicence)?.display, if (o.hasLicencePhoto) l.onbPhotoAdded].join(' · '), check: o.check(KycKind.drivingLicence), o: o, onTap: () => _open(context, ref, _LicenceSheet(hasPhoto: o.hasLicencePhoto, number: o.check(KycKind.drivingLicence)?.valuePublic)))
          else
            ListTile(key: const ValueKey('step-driving_licence'), leading: const Icon(Icons.check_circle, color: SanthaColors.leaf), title: Text(l.onbStepLicence), subtitle: Text(l.onbNoLicenceNeeded)),
          _StepTile(stepKey: 'bank', title: l.onbStepBank, subtitle: o.check(KycKind.bank)?.display, check: o.check(KycKind.bank), o: o, onTap: () => _open(context, ref, const _BankSheet())),
          const SizedBox(height: SanthaSpacing.s6),
          SanthaButton(
            key: const ValueKey('onb-submit'),
            label: l.onbSubmit,
            onPressed: o.complete ? () => _submit(context, ref) : null,
          ),
          if (!o.complete) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s2), child: Text(l.onbIncomplete, textAlign: TextAlign.center, style: text.bodySmall?.copyWith(color: SanthaColors.slate))),
        ],
      ),
    );
  }

  /// The identity step shows Aadhaar when it was tried, else PAN.
  KycCheck? _identityCheck(RiderOnboarding o) {
    final a = o.check(KycKind.aadhaar), p = o.check(KycKind.pan);
    if (a?.status == KycStatus.verified) return a;
    if (p?.status == KycStatus.verified) return p;
    return a ?? p;
  }

  Future<void> _open(BuildContext context, WidgetRef ref, Widget sheet) async {
    await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => sheet);
    ref.invalidate(riderOnboardingProvider);
  }

  /// Sign-up photo (ADR-030): camera, upload, refresh the steps.
  Future<void> _takePhoto(BuildContext context, WidgetRef ref, String kind, {bool front = false}) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final picked = await ref.read(photoTakerProvider)(front: front);
    if (picked == null) return;
    try {
      await ref.read(riderApiProvider).uploadPhoto(picked.bytes, kind: kind, contentType: picked.contentType);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(l.apiError(e))));
    }
    ref.invalidate(riderOnboardingProvider);
  }

  Future<void> _submit(BuildContext context, WidgetRef ref) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(riderApiProvider).submit();
      ref.read(analyticsProvider).track('rider_signup_submitted', {});
      await ref.read(riderHomeProvider.notifier).reload();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(l.apiError(e))));
      ref.invalidate(riderOnboardingProvider);
    }
  }
}

class _Notice extends StatelessWidget {
  const _Notice({super.key, required this.icon, required this.title, required this.body, this.action});
  final IconData icon;
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return ListView(padding: const EdgeInsets.all(SanthaSpacing.s6), children: [
      const SizedBox(height: SanthaSpacing.s6),
      Icon(icon, size: 64, color: SanthaColors.indigo),
      const SizedBox(height: SanthaSpacing.s4),
      Text(title, textAlign: TextAlign.center, style: text.headlineSmall),
      const SizedBox(height: SanthaSpacing.s3),
      Text(body, textAlign: TextAlign.center, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
      if (action != null) ...[const SizedBox(height: SanthaSpacing.s6), action!],
    ]);
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({required this.stepKey, required this.title, required this.o, required this.onTap, this.subtitle, this.check});
  final String stepKey;
  final String title;
  final String? subtitle;
  final KycCheck? check;
  final RiderOnboarding o;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final done = o.done(stepKey);
    final failed = !done && check?.status == KycStatus.failed;
    final status = done ? (check?.status == KycStatus.pending ? l.onbBeingChecked : l.onbDone) : (failed ? l.onbNotVerified : l.onbTodo);
    return Card(
      key: ValueKey('step-$stepKey'),
      child: ListTile(
        leading: Icon(done ? Icons.check_circle : (failed ? Icons.error : Icons.radio_button_unchecked), color: done ? SanthaColors.leaf : (failed ? SanthaColors.chilli : SanthaColors.slate)),
        title: Text(title),
        subtitle: Text([status, ?subtitle, if (failed && check?.failureReason != null) check!.failureReason!].join(' · ')),
        trailing: o.editable ? const Icon(Icons.chevron_right) : null,
        onTap: o.editable ? onTap : null,
      ),
    );
  }
}

/// Shared bottom-sheet frame: title, fields, an error line and the main button.
class _Sheet extends StatelessWidget {
  const _Sheet({required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(SanthaSpacing.s4, SanthaSpacing.s4, SanthaSpacing.s4, MediaQuery.viewInsetsOf(context).bottom + SanthaSpacing.s4),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: SanthaSpacing.s3),
              ...children,
            ]),
          ),
        ),
      );
}

/// Runs a sheet action: busy flag, localized error, closes the sheet on success.
mixin _SheetAction<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  bool busy = false;
  String? error;

  Future<void> act(Future<bool> Function(RiderApi api) fn) async {
    final l = AppLocalizations.of(context);
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final close = await fn(ref.read(riderApiProvider));
      if (close && mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => error = l.apiError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget errorLine() => error == null
      ? const SizedBox.shrink()
      : Padding(padding: const EdgeInsets.only(bottom: SanthaSpacing.s3), child: Text(error!, key: const ValueKey('onb-error'), style: const TextStyle(color: SanthaColors.chilli)));
}

/// A failed provider check is a normal answer, not an exception: show its reason and keep the sheet open.
String? _failure(AppLocalizations l, KycCheck c) => c.status == KycStatus.failed ? (c.failureReason ?? l.onbNotVerified) : null;

class _ProfileSheet extends ConsumerStatefulWidget {
  const _ProfileSheet({required this.o});
  final RiderOnboarding o;
  @override
  ConsumerState<_ProfileSheet> createState() => _ProfileSheetState();
}

class _ProfileSheetState extends ConsumerState<_ProfileSheet> with _SheetAction {
  late final _name = TextEditingController(text: widget.o.name == 'Rider' ? '' : widget.o.name);
  late final _plate = TextEditingController(text: widget.o.vehicleNumber ?? '');
  late RiderVehicle _vehicle = widget.o.vehicle;

  @override
  void dispose() {
    _name.dispose();
    _plate.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return _Sheet(title: l.onbStepProfile, children: [
      TextField(key: const ValueKey('onb-name'), controller: _name, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: l.onbName)),
      const SizedBox(height: SanthaSpacing.s3),
      Text(l.onbVehicle, style: Theme.of(context).textTheme.labelLarge),
      Wrap(spacing: SanthaSpacing.s2, children: [
        for (final v in RiderVehicle.values)
          ChoiceChip(key: ValueKey('vehicle-${v.name}'), label: Text(l.vehicleName(v)), selected: _vehicle == v, onSelected: (_) => setState(() => _vehicle = v)),
      ]),
      if (_vehicle.needsLicence) ...[
        const SizedBox(height: SanthaSpacing.s3),
        TextField(
          key: const ValueKey('onb-plate'),
          controller: _plate,
          textCapitalization: TextCapitalization.characters,
          decoration: InputDecoration(labelText: l.onbVehicleNumber, hintText: 'AP 26 AB 1234'),
        ),
      ],
      const SizedBox(height: SanthaSpacing.s4),
      errorLine(),
      SanthaButton(
        key: const ValueKey('onb-save-profile'),
        label: l.onbSave,
        loading: busy,
        onPressed: busy
            ? null
            : () => act((api) async {
                  await api.updateProfile(name: _name.text.trim(), vehicle: _vehicle, vehicleNumber: _plate.text.trim());
                  return true;
                }),
      ),
    ]);
  }
}

class _IdentitySheet extends ConsumerStatefulWidget {
  const _IdentitySheet();
  @override
  ConsumerState<_IdentitySheet> createState() => _IdentitySheetState();
}

class _IdentitySheetState extends ConsumerState<_IdentitySheet> with _SheetAction {
  final _aadhaar = TextEditingController();
  final _otp = TextEditingController();
  final _pan = TextEditingController();
  final _panName = TextEditingController();
  bool _usePan = false;
  bool _otpSent = false;

  @override
  void dispose() {
    for (final c in [_aadhaar, _otp, _pan, _panName]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final digits = [FilteringTextInputFormatter.digitsOnly];
    return _Sheet(title: l.onbStepIdentity, children: [
      if (!_usePan) ...[
        TextField(key: const ValueKey('onb-aadhaar'), controller: _aadhaar, enabled: !_otpSent, keyboardType: TextInputType.number, inputFormatters: digits, maxLength: 12, decoration: InputDecoration(labelText: l.onbAadhaar, counterText: '')),
        if (_otpSent) TextField(key: const ValueKey('onb-aadhaar-otp'), controller: _otp, keyboardType: TextInputType.number, inputFormatters: digits, maxLength: 6, decoration: InputDecoration(labelText: l.onbAadhaarOtp, counterText: '')),
        const SizedBox(height: SanthaSpacing.s3),
        errorLine(),
        SanthaButton(
          key: const ValueKey('onb-aadhaar-go'),
          label: _otpSent ? l.onbVerify : l.onbSendOtp,
          loading: busy,
          onPressed: busy
              ? null
              : () => act((api) async {
                    if (!_otpSent) {
                      final c = await api.startAadhaar(_aadhaar.text.trim());
                      setState(() => _otpSent = c.status == KycStatus.pending);
                      if (c.status == KycStatus.failed) setState(() => error = _failure(l, c));
                      return false;
                    }
                    final c = await api.verifyAadhaar(_otp.text.trim());
                    if (c.status == KycStatus.failed) {
                      // A wrong code ends this attempt: send a new OTP.
                      setState(() {
                        error = _failure(l, c);
                        _otpSent = false;
                        _otp.clear();
                      });
                      return false;
                    }
                    return true;
                  }),
        ),
      ] else ...[
        TextField(key: const ValueKey('onb-pan'), controller: _pan, textCapitalization: TextCapitalization.characters, maxLength: 10, decoration: InputDecoration(labelText: l.onbPan, counterText: '')),
        TextField(key: const ValueKey('onb-pan-name'), controller: _panName, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: l.onbPanName)),
        const SizedBox(height: SanthaSpacing.s3),
        errorLine(),
        SanthaButton(
          key: const ValueKey('onb-pan-go'),
          label: l.onbVerify,
          loading: busy,
          onPressed: busy
              ? null
              : () => act((api) async {
                    final c = await api.verifyPan(pan: _pan.text.trim().toUpperCase(), name: _panName.text.trim());
                    if (c.status == KycStatus.failed) {
                      setState(() => error = _failure(l, c));
                      return false;
                    }
                    return true;
                  }),
        ),
      ],
      TextButton(
        key: const ValueKey('onb-identity-switch'),
        onPressed: busy
            ? null
            : () => setState(() {
                  _usePan = !_usePan;
                  error = null;
                }),
        child: Text(_usePan ? l.onbUseAadhaar : l.onbUsePan),
      ),
    ]);
  }
}

class _LicenceSheet extends ConsumerStatefulWidget {
  const _LicenceSheet({required this.hasPhoto, this.number});
  final bool hasPhoto;
  final String? number;
  @override
  ConsumerState<_LicenceSheet> createState() => _LicenceSheetState();
}

class _LicenceSheetState extends ConsumerState<_LicenceSheet> with _SheetAction {
  late final _number = TextEditingController(text: widget.number ?? '');
  late bool _hasPhoto = widget.hasPhoto;

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return _Sheet(title: l.onbStepLicence, children: [
      TextField(key: const ValueKey('onb-licence'), controller: _number, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: l.onbLicence, hintText: 'AP09 2015 0001234')),
      Padding(padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s2), child: Text(l.onbLicenceNote, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SanthaColors.slate))),
      // A photo of the card for ops to compare (ADR-030).
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(_hasPhoto ? Icons.check_circle : Icons.photo_camera, color: _hasPhoto ? SanthaColors.leaf : SanthaColors.indigo),
        title: Text(l.onbLicencePhoto),
        subtitle: Text(_hasPhoto ? l.onbPhotoAdded : l.onbTodo),
        trailing: TextButton(
          key: const ValueKey('onb-licence-photo'),
          onPressed: busy
              ? null
              : () => act((api) async {
                    final picked = await ref.read(photoTakerProvider)();
                    if (picked == null) return false;
                    await api.uploadPhoto(picked.bytes, kind: 'licence', contentType: picked.contentType);
                    setState(() => _hasPhoto = true);
                    return false;
                  }),
          child: Text(l.onbTakePhoto),
        ),
      ),
      errorLine(),
      SanthaButton(
        key: const ValueKey('onb-save-licence'),
        label: l.onbSave,
        loading: busy,
        onPressed: busy
            ? null
            : () => act((api) async {
                  await api.recordDrivingLicence(_number.text.trim());
                  return true;
                }),
      ),
    ]);
  }
}

class _BankSheet extends ConsumerStatefulWidget {
  const _BankSheet();
  @override
  ConsumerState<_BankSheet> createState() => _BankSheetState();
}

class _BankSheetState extends ConsumerState<_BankSheet> with _SheetAction {
  final _account = TextEditingController();
  final _ifsc = TextEditingController();
  final _holder = TextEditingController();

  @override
  void dispose() {
    for (final c in [_account, _ifsc, _holder]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return _Sheet(title: l.onbStepBank, children: [
      TextField(key: const ValueKey('onb-account'), controller: _account, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9 ]'))], decoration: InputDecoration(labelText: l.onbAccount)),
      TextField(key: const ValueKey('onb-ifsc'), controller: _ifsc, textCapitalization: TextCapitalization.characters, maxLength: 11, decoration: InputDecoration(labelText: l.onbIfsc, hintText: 'SBIN0001234', counterText: '')),
      TextField(key: const ValueKey('onb-holder'), controller: _holder, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: l.onbHolder)),
      const SizedBox(height: SanthaSpacing.s3),
      errorLine(),
      SanthaButton(
        key: const ValueKey('onb-save-bank'),
        label: l.onbVerify,
        loading: busy,
        onPressed: busy
            ? null
            : () => act((api) async {
                  final c = await api.verifyBank(accountNumber: _account.text.replaceAll(' ', ''), ifsc: _ifsc.text.trim().toUpperCase(), holderName: _holder.text.trim());
                  if (c.status == KycStatus.failed) {
                    setState(() => error = _failure(l, c));
                    return false;
                  }
                  return true;
                }),
      ),
    ]);
  }
}
