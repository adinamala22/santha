import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/onboarding_controller.dart';
import 'copy.dart';
import 'widgets.dart';

/// `/onboarding/:step` → the page for that checklist step (or staff).
class StepRouter extends ConsumerWidget {
  const StepRouter({super.key, required this.step});
  final String step;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(onboardingProvider).value;
    if (view == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return switch (step) {
      'business' => BusinessStep(view: view),
      'location' => LocationStep(view: view),
      'hours' => HoursStep(view: view),
      'pan' => PanStep(view: view),
      'aadhaar' => AadhaarStep(view: view),
      'gst' => GstStep(view: view),
      'fssai' => LicenceStep(view: view, kind: KycKind.fssai),
      'drug_licence' => LicenceStep(view: view, kind: KycKind.drugLicence),
      'bank' => BankStep(view: view),
      'hygiene' => HygieneStep(view: view),
      'return_policy' => ReturnPolicyStep(view: view),
      'staff' => StaffPage(view: view),
      _ => const Scaffold(body: SizedBox.shrink()),
    };
  }
}

OnboardingController _ctrl(WidgetRef ref) => ref.read(onboardingProvider.notifier);

// ───────── profile steps ─────────

class BusinessStep extends ConsumerStatefulWidget {
  const BusinessStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<BusinessStep> createState() => _BusinessStepState();
}

class _BusinessStepState extends ConsumerState<BusinessStep> with StepActions {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.view.merchant.name);
  late final _nameTe = TextEditingController(text: widget.view.merchant.nameTe ?? '');
  late final _about = TextEditingController(text: widget.view.merchant.description ?? '');

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StepScaffold(
      title: l.stepBusiness,
      formKey: _form,
      busy: busy,
      error: error,
      actionLabel: l.save,
      onAction: () {
        if (!_form.currentState!.validate()) return;
        run(() async {
          await _ctrl(ref).save({
            'name': _name.text.trim(),
            'nameTe': _nameTe.text.trim().isEmpty ? null : _nameTe.text.trim(),
            'description': _about.text.trim().isEmpty ? null : _about.text.trim(),
          }, step: 'business');
          if (context.mounted) context.pop();
        });
      },
      children: [
        TextFormField(controller: _name, decoration: InputDecoration(labelText: l.onbShopName), validator: (v) => requiredField(l, v)),
        gap,
        TextFormField(controller: _nameTe, decoration: InputDecoration(labelText: l.fieldNameTe)),
        gap,
        TextFormField(controller: _about, maxLines: 3, maxLength: 500, decoration: InputDecoration(labelText: l.fieldDescription)),
      ],
    );
  }
}

class LocationStep extends ConsumerStatefulWidget {
  const LocationStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<LocationStep> createState() => _LocationStepState();
}

class _LocationStepState extends ConsumerState<LocationStep> with StepActions {
  final _form = GlobalKey<FormState>();
  late final _address = TextEditingController(text: widget.view.merchant.addressLine ?? '');
  late final _landmark = TextEditingController(text: widget.view.merchant.landmark ?? '');
  late final _pincode = TextEditingController(text: widget.view.merchant.pincode ?? '');
  late LatLng? _point = widget.view.merchant.location;
  bool _locating = false;
  String? _locError;

  Future<void> _locate() async {
    final l = AppLocalizations.of(context);
    setState(() {
      _locating = true;
      _locError = null;
    });
    final r = await ref.read(locationReaderProvider)();
    if (!mounted) return;
    setState(() {
      _locating = false;
      switch (r) {
        case LocationOk(:final lat, :final lng):
          _point = LatLng(lat, lng);
        case LocationDenied():
          _locError = l.locPermissionDenied;
        case LocationServiceOff():
          _locError = l.locServiceOff;
      }
    });
    // Save the point straight away so the micro-market check shows below.
    if (_point != null) await run(() => _ctrl(ref).save({'location': _point!.toJson()}, step: 'location_gps'));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final view = ref.watch(onboardingProvider).value ?? widget.view;
    final locale = Localizations.localeOf(context).languageCode;
    final market = view.microMarket;
    return StepScaffold(
      title: l.stepLocation,
      formKey: _form,
      busy: busy,
      error: error,
      actionLabel: l.save,
      onAction: () {
        if (_point == null) return setState(() => _locError = l.errLocationFirst);
        if (!_form.currentState!.validate()) return;
        run(() async {
          await _ctrl(ref).save({
            'location': _point!.toJson(),
            'addressLine': _address.text.trim(),
            'landmark': _landmark.text.trim().isEmpty ? null : _landmark.text.trim(),
            'pincode': _pincode.text.trim(),
          }, step: 'location');
          if (context.mounted) context.pop();
        });
      },
      children: [
        Text(l.locTitle, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: SanthaSpacing.s2),
        Text(l.locSub, style: const TextStyle(color: SanthaColors.slate)),
        gap,
        SanthaButton(
          key: const ValueKey('use-gps'),
          label: _locating ? l.locLocating : l.locUseGps,
          icon: Icons.my_location,
          variant: SanthaButtonVariant.outline,
          loading: _locating,
          onPressed: _locating ? null : _locate,
        ),
        if (_locError != null) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s2), child: Text(_locError!, style: const TextStyle(color: SanthaColors.chilli))),
        if (view.merchant.location != null)
          Padding(
            padding: const EdgeInsets.only(top: SanthaSpacing.s3),
            child: market != null
                ? Text(l.locFound(locale == 'te' ? market.nameTe : market.name), key: const ValueKey('market'), style: const TextStyle(color: SanthaColors.leaf, fontWeight: FontWeight.w500))
                : Text(l.locNotServiceable, key: const ValueKey('not-serviceable'), style: const TextStyle(color: SanthaColors.marigold600)),
          ),
        const SizedBox(height: SanthaSpacing.s6),
        TextFormField(controller: _address, decoration: InputDecoration(labelText: l.locAddress), validator: (v) => (v == null || v.trim().length < 5) ? l.errAddress : null),
        gap,
        TextFormField(controller: _landmark, decoration: InputDecoration(labelText: l.locLandmark)),
        gap,
        TextFormField(
          controller: _pincode,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          decoration: InputDecoration(labelText: l.locPincode),
          validator: (v) => RegExp(r'^5\d{5}$').hasMatch(v ?? '') ? null : l.errPincode,
        ),
      ],
    );
  }
}

class HoursStep extends ConsumerStatefulWidget {
  const HoursStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<HoursStep> createState() => _HoursStepState();
}

class _HoursStepState extends ConsumerState<HoursStep> with StepActions {
  late String _open;
  late String _close;
  late Set<String> _closed;
  late double _radiusKm = widget.view.merchant.radiusM / 1000;
  late final _mov = TextEditingController(text: (widget.view.merchant.movPaise ~/ 100).toString());
  late FulfilmentMode _mode = widget.view.merchant.defaultFulfilment;

  @override
  void initState() {
    super.initState();
    final h = widget.view.merchant.hours;
    final first = h?.values.expand((r) => r).firstOrNull;
    _open = first?.open ?? '09:00';
    _close = first?.close ?? '21:00';
    _closed = {for (final d in weekDays) if (h != null && (h[d] ?? const []).isEmpty) d};
  }

  Future<void> _pick(bool open) async {
    final cur = (open ? _open : _close).split(':');
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(cur[0]), minute: int.parse(cur[1])));
    if (t == null) return;
    final v = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    setState(() => open ? _open = v : _close = v);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StepScaffold(
      title: l.stepHours,
      busy: busy,
      error: error,
      actionLabel: l.save,
      onAction: () {
        if (_open.compareTo(_close) >= 0 || _closed.length == 7) return setState(() => error = l.errHours);
        run(() async {
          await _ctrl(ref).save({
            'hours': {for (final d in weekDays) d: _closed.contains(d) ? [] : [TimeRange(_open, _close).toJson()]},
            'radiusM': (_radiusKm * 1000).round(),
            'movPaise': (int.tryParse(_mov.text) ?? 0) * 100,
            'defaultFulfilment': _mode.name,
          }, step: 'hours');
          if (context.mounted) context.pop();
        });
      },
      children: [
        Row(children: [
          Expanded(child: _TimeField(label: l.hoursOpen, value: _open, onTap: () => _pick(true))),
          const SizedBox(width: SanthaSpacing.s3),
          Expanded(child: _TimeField(label: l.hoursClose, value: _close, onTap: () => _pick(false))),
        ]),
        gap,
        Text(l.hoursClosedOn),
        Wrap(spacing: SanthaSpacing.s2, children: [
          for (final d in weekDays)
            FilterChip(
              label: Text(l.dayLabel(d)),
              selected: _closed.contains(d),
              onSelected: (s) => setState(() => s ? _closed.add(d) : _closed.remove(d)),
            ),
        ]),
        const SizedBox(height: SanthaSpacing.s6),
        Text(l.radius(_radiusKm.toStringAsFixed(_radiusKm % 1 == 0 ? 0 : 1))),
        Slider(value: _radiusKm, min: 0.5, max: 10, divisions: 19, label: '${_radiusKm.toStringAsFixed(1)} km', onChanged: (v) => setState(() => _radiusKm = v)),
        gap,
        TextFormField(
          controller: _mov,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
          decoration: InputDecoration(labelText: l.mov, prefixText: '₹ '),
        ),
        const SizedBox(height: SanthaSpacing.s6),
        Text(l.deliveryDefault, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: SanthaSpacing.s2),
        SegmentedButton<FulfilmentMode>(
          segments: [
            ButtonSegment(value: FulfilmentMode.self, label: Text(l.deliverySelf), icon: const Icon(Icons.storefront)),
            ButtonSegment(value: FulfilmentMode.rider, label: Text(l.deliveryRider), icon: const Icon(Icons.two_wheeler)),
          ],
          selected: {_mode},
          onSelectionChanged: (s) => setState(() => _mode = s.first),
        ),
        const SizedBox(height: SanthaSpacing.s2),
        Text(l.deliveryHint, style: const TextStyle(color: SanthaColors.slate)),
      ],
    );
  }
}

class _TimeField extends StatelessWidget {
  const _TimeField({required this.label, required this.value, required this.onTap});
  final String label;
  final String value;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: InputDecorator(decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.schedule)), child: Text(value)),
      );
}

// ───────── KYC steps ─────────

abstract class _KycState<T extends ConsumerStatefulWidget> extends ConsumerState<T> with StepActions {
  final form = GlobalKey<FormState>();
  KycCheck? result;

  /// Runs the check; pops back to the checklist when verified, otherwise shows the reason.
  void verify(Future<KycCheck> Function(MerchantApi api) call) {
    if (!form.currentState!.validate()) return;
    run(() async {
      final c = await _ctrl(ref).kyc(call);
      if (!mounted) return;
      setState(() => result = c);
      if (c.status == KycStatus.verified && context.mounted) context.pop();
    });
  }
}

TextInputFormatter get _upper => TextInputFormatter.withFunction((o, n) => n.copyWith(text: n.text.toUpperCase()));

class PanStep extends ConsumerStatefulWidget {
  const PanStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<PanStep> createState() => _PanStepState();
}

class _PanStepState extends _KycState<PanStep> {
  final _pan = TextEditingController();
  final _name = TextEditingController();
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StepScaffold(
      title: l.stepPan,
      formKey: form,
      busy: busy,
      error: error,
      actionLabel: l.kycVerify,
      onAction: () => verify((api) => api.verifyPan(pan: _pan.text.trim(), name: _name.text.trim())),
      children: [
        KycBanner(check: result ?? widget.view.check(KycKind.pan)),
        TextFormField(
          key: const ValueKey('pan'),
          controller: _pan,
          textCapitalization: TextCapitalization.characters,
          inputFormatters: [_upper, LengthLimitingTextInputFormatter(10)],
          decoration: InputDecoration(labelText: l.panNumber, hintText: 'ABCPE1234F'),
          validator: (v) => RegExp(r'^[A-Z]{5}\d{4}[A-Z]$').hasMatch(v ?? '') ? null : l.errValidation,
        ),
        gap,
        TextFormField(key: const ValueKey('pan-name'), controller: _name, decoration: InputDecoration(labelText: l.panName), validator: (v) => requiredField(l, v)),
      ],
    );
  }
}

class AadhaarStep extends ConsumerStatefulWidget {
  const AadhaarStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<AadhaarStep> createState() => _AadhaarStepState();
}

class _AadhaarStepState extends _KycState<AadhaarStep> {
  final _number = TextEditingController();
  final _otp = TextEditingController();
  bool _otpSent = false;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StepScaffold(
      title: l.stepAadhaar,
      formKey: form,
      busy: busy,
      error: error,
      actionLabel: _otpSent ? l.kycVerify : l.aadhaarSendOtp,
      onAction: () {
        if (!_otpSent) {
          if (!form.currentState!.validate()) return;
          run(() async {
            final c = await _ctrl(ref).kyc((api) => api.startAadhaar(_number.text.replaceAll(' ', '')));
            if (mounted) {
              setState(() {
                result = c;
                _otpSent = c.status == KycStatus.pending;
              });
            }
          });
        } else {
          if (!form.currentState!.validate()) return;
          run(() async {
            final c = await _ctrl(ref).kyc((api) => api.verifyAadhaar(_otp.text.trim()));
            if (!mounted) return;
            setState(() {
              result = c;
              _otpSent = false; // a wrong OTP means starting again with a new one
              _otp.clear();
            });
            if (c.status == KycStatus.verified && context.mounted) context.pop();
          });
        }
      },
      children: [
        KycBanner(check: result ?? widget.view.check(KycKind.aadhaar)),
        TextFormField(
          key: const ValueKey('aadhaar'),
          controller: _number,
          enabled: !_otpSent,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(12)],
          decoration: InputDecoration(labelText: l.aadhaarNumber),
          validator: (v) => RegExp(r'^[2-9]\d{11}$').hasMatch(v ?? '') ? null : l.errValidation,
        ),
        if (_otpSent) ...[
          gap,
          Text(l.aadhaarOtpSent, style: const TextStyle(color: SanthaColors.slate)),
          gap,
          TextFormField(
            key: const ValueKey('aadhaar-otp'),
            controller: _otp,
            keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            decoration: InputDecoration(labelText: l.aadhaarOtp),
            validator: (v) => (v?.length ?? 0) == 6 ? null : l.errorInvalidCode,
          ),
        ],
      ],
    );
  }
}

class GstStep extends ConsumerStatefulWidget {
  const GstStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<GstStep> createState() => _GstStepState();
}

class _GstStepState extends _KycState<GstStep> {
  late bool _exempt = widget.view.check(KycKind.gstin) == null && widget.view.check(KycKind.gstExemption) != null;
  final _gstin = TextEditingController();
  late final _reason = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    if (_reason.text.isEmpty) _reason.text = l.gstExemptDefault;
    return StepScaffold(
      title: l.stepGst,
      formKey: form,
      busy: busy,
      error: error,
      actionLabel: _exempt ? l.gstDeclare : l.kycVerify,
      onAction: () => _exempt ? verify((api) => api.declareGstExemption(_reason.text.trim())) : verify((api) => api.verifyGstin(_gstin.text.trim())),
      children: [
        KycBanner(check: result ?? widget.view.check(_exempt ? KycKind.gstExemption : KycKind.gstin)),
        SegmentedButton<bool>(
          segments: [ButtonSegment(value: false, label: Text(l.gstHaveGstin)), ButtonSegment(value: true, label: Text(l.gstExempt))],
          selected: {_exempt},
          onSelectionChanged: (s) => setState(() {
            _exempt = s.first;
            result = null;
          }),
        ),
        gap,
        if (_exempt)
          TextFormField(controller: _reason, maxLines: 2, decoration: InputDecoration(labelText: l.gstExemptReason), validator: (v) => (v ?? '').trim().length >= 5 ? null : l.errRequired)
        else
          TextFormField(
            key: const ValueKey('gstin'),
            controller: _gstin,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [_upper, LengthLimitingTextInputFormatter(15)],
            decoration: InputDecoration(labelText: l.gstin, hintText: '37ABCPE1234F1Z5'),
            validator: (v) => (v ?? '').length == 15 ? null : l.errValidation,
          ),
      ],
    );
  }
}

/// FSSAI (food sellers) and drug licence (pharmacies): one number each.
class LicenceStep extends ConsumerStatefulWidget {
  const LicenceStep({super.key, required this.view, required this.kind});
  final MerchantView view;
  final KycKind kind;
  @override
  ConsumerState<LicenceStep> createState() => _LicenceStepState();
}

class _LicenceStepState extends _KycState<LicenceStep> {
  final _number = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final fssai = widget.kind == KycKind.fssai;
    return StepScaffold(
      title: fssai ? l.stepFssai : l.stepDrugLicence,
      formKey: form,
      busy: busy,
      error: error,
      actionLabel: l.kycVerify,
      onAction: () => verify((api) => fssai ? api.verifyFssai(_number.text.trim()) : api.recordDrugLicence(_number.text.trim())),
      children: [
        KycBanner(check: result ?? widget.view.check(widget.kind)),
        TextFormField(
          key: ValueKey(widget.kind.wire),
          controller: _number,
          keyboardType: fssai ? TextInputType.number : TextInputType.text,
          textCapitalization: TextCapitalization.characters,
          inputFormatters: fssai ? [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(14)] : [_upper],
          decoration: InputDecoration(labelText: fssai ? l.fssaiNumber : l.drugNumber),
          validator: (v) => fssai ? (RegExp(r'^[12]\d{13}$').hasMatch(v ?? '') ? null : l.errValidation) : requiredField(l, v),
        ),
        const SizedBox(height: SanthaSpacing.s2),
        Text(fssai ? l.fssaiHelp : l.drugHelp, style: const TextStyle(color: SanthaColors.slate)),
      ],
    );
  }

  @override
  void verify(Future<KycCheck> Function(MerchantApi api) call) {
    // Drug licences are reviewed by ops (status pending), so go back once recorded.
    if (widget.kind != KycKind.drugLicence) return super.verify(call);
    if (!form.currentState!.validate()) return;
    run(() async {
      await _ctrl(ref).kyc(call);
      if (!mounted) return;
      context.pop();
    });
  }
}

class BankStep extends ConsumerStatefulWidget {
  const BankStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<BankStep> createState() => _BankStepState();
}

class _BankStepState extends _KycState<BankStep> {
  final _account = TextEditingController();
  final _confirm = TextEditingController();
  final _ifsc = TextEditingController();
  final _holder = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StepScaffold(
      title: l.stepBank,
      formKey: form,
      busy: busy,
      error: error,
      actionLabel: l.kycVerify,
      onAction: () => verify((api) => api.verifyBank(accountNumber: _account.text.trim(), ifsc: _ifsc.text.trim(), holderName: _holder.text.trim())),
      children: [
        KycBanner(check: result ?? widget.view.check(KycKind.bank)),
        TextFormField(
          key: const ValueKey('account'),
          controller: _account,
          obscureText: true,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(18)],
          decoration: InputDecoration(labelText: l.bankAccount),
          validator: (v) => (v ?? '').length >= 9 ? null : l.errValidation,
        ),
        gap,
        TextFormField(
          key: const ValueKey('account-confirm'),
          controller: _confirm,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(18)],
          decoration: InputDecoration(labelText: l.bankConfirm),
          validator: (v) => v == _account.text ? null : l.bankMismatch,
        ),
        gap,
        TextFormField(
          key: const ValueKey('ifsc'),
          controller: _ifsc,
          textCapitalization: TextCapitalization.characters,
          inputFormatters: [_upper, LengthLimitingTextInputFormatter(11)],
          decoration: InputDecoration(labelText: l.bankIfsc, hintText: 'SBIN0001234'),
          validator: (v) => RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$').hasMatch(v ?? '') ? null : l.errValidation,
        ),
        gap,
        TextFormField(key: const ValueKey('holder'), controller: _holder, decoration: InputDecoration(labelText: l.bankHolder), validator: (v) => requiredField(l, v)),
        const SizedBox(height: SanthaSpacing.s2),
        Text(l.bankNote, style: const TextStyle(color: SanthaColors.slate)),
      ],
    );
  }
}

// ───────── declarations ─────────

class HygieneStep extends ConsumerStatefulWidget {
  const HygieneStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<HygieneStep> createState() => _HygieneStepState();
}

class _HygieneStepState extends ConsumerState<HygieneStep> with StepActions {
  late final List<bool> _checked = List.filled(4, widget.view.merchant.hygieneDeclaredAt != null);

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final items = [l.hygiene1, l.hygiene2, l.hygiene3, l.hygiene4];
    return StepScaffold(
      title: l.stepHygiene,
      busy: busy,
      error: error,
      actionLabel: l.hygieneConfirm,
      onAction: _checked.every((c) => c)
          ? () => run(() async {
                await _ctrl(ref).save({'hygieneDeclared': true}, step: 'hygiene');
                if (context.mounted) context.pop();
              })
          : null,
      children: [
        Text(l.hygieneTitle, style: Theme.of(context).textTheme.titleLarge),
        gap,
        for (var i = 0; i < items.length; i++)
          CheckboxListTile(
            key: ValueKey('hygiene-$i'),
            contentPadding: EdgeInsets.zero,
            value: _checked[i],
            onChanged: (v) => setState(() => _checked[i] = v ?? false),
            title: Text(items[i]),
          ),
      ],
    );
  }
}

class ReturnPolicyStep extends ConsumerStatefulWidget {
  const ReturnPolicyStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<ReturnPolicyStep> createState() => _ReturnPolicyStepState();
}

class _ReturnPolicyStepState extends ConsumerState<ReturnPolicyStep> with StepActions {
  final _form = GlobalKey<FormState>();
  late final _policy = TextEditingController(text: widget.view.merchant.returnPolicy ?? '');

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StepScaffold(
      title: l.stepReturnPolicy,
      formKey: _form,
      busy: busy,
      error: error,
      actionLabel: l.save,
      onAction: () {
        if (!_form.currentState!.validate()) return;
        run(() async {
          await _ctrl(ref).save({'returnPolicy': _policy.text.trim()}, step: 'return_policy');
          if (context.mounted) context.pop();
        });
      },
      children: [
        TextFormField(
          controller: _policy,
          maxLines: 4,
          maxLength: 1000,
          decoration: InputDecoration(labelText: l.returnPolicyLabel, hintText: l.returnPolicyHint),
          validator: (v) => (v ?? '').trim().length >= 10 ? null : l.errReturnPolicy,
        ),
      ],
    );
  }
}

// ───────── staff ─────────

class StaffPage extends ConsumerStatefulWidget {
  const StaffPage({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<StaffPage> createState() => _StaffPageState();
}

class _StaffPageState extends ConsumerState<StaffPage> with StepActions {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final staff = ref.watch(onboardingProvider).value?.staff ?? widget.view.staff;
    return StepScaffold(
      title: l.onbStaff,
      formKey: _form,
      busy: busy,
      error: error,
      actionLabel: l.staffAdd,
      onAction: () {
        if (!_form.currentState!.validate()) return;
        run(() async {
          await _ctrl(ref).addStaff(name: _name.text.trim(), phone: _phone.text.trim());
          _name.clear();
          _phone.clear();
        });
      },
      children: [
        Text(l.onbStaffSub, style: const TextStyle(color: SanthaColors.slate)),
        gap,
        for (final s in staff)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.person, color: SanthaColors.indigo),
            title: Text(s.name),
            subtitle: Text(s.phoneMasked),
            trailing: IconButton(
              tooltip: l.staffRemove(s.name),
              icon: const Icon(Icons.delete_outline, color: SanthaColors.chilli),
              onPressed: busy ? null : () => run(() => _ctrl(ref).removeStaff(s.id)),
            ),
          ),
        gap,
        TextFormField(key: const ValueKey('staff-name'), controller: _name, decoration: InputDecoration(labelText: l.staffName), validator: (v) => requiredField(l, v)),
        gap,
        TextFormField(
          key: const ValueKey('staff-phone'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
          decoration: InputDecoration(labelText: l.staffPhone, prefixText: '+91 '),
          validator: (v) => RegExp(r'^[6-9]\d{9}$').hasMatch(v ?? '') ? null : l.errorInvalidPhone,
        ),
      ],
    );
  }
}
