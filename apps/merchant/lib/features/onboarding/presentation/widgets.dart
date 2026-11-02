import 'package:flutter/material.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import 'copy.dart';

/// Frame for one onboarding step: title, scrolling form, error line and a full-width action.
class StepScaffold extends StatelessWidget {
  const StepScaffold({
    super.key,
    required this.title,
    required this.children,
    required this.actionLabel,
    required this.onAction,
    this.busy = false,
    this.error,
    this.formKey,
  });

  final String title;
  final List<Widget> children;
  final String actionLabel;
  final VoidCallback? onAction;
  final bool busy;
  final String? error;
  final GlobalKey<FormState>? formKey;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.all(SanthaSpacing.s6),
            children: [
              ...children,
              if (error != null) ...[
                const SizedBox(height: SanthaSpacing.s4),
                Text(error!, style: const TextStyle(color: SanthaColors.chilli), semanticsLabel: error),
              ],
              const SizedBox(height: SanthaSpacing.s8),
              SanthaButton(label: actionLabel, loading: busy, onPressed: busy ? null : onAction),
            ],
          ),
        ),
      ),
    );
  }
}

const gap = SizedBox(height: SanthaSpacing.s4);

/// Shows the latest result of a KYC check (verified / failed with reason / pending).
class KycBanner extends StatelessWidget {
  const KycBanner({super.key, required this.check, this.pendingText});
  final KycCheck? check;

  /// What "pending" means for this check (e.g. Aadhaar: waiting for the OTP, not for review).
  final String? pendingText;

  @override
  Widget build(BuildContext context) {
    final c = check;
    if (c == null) return const SizedBox.shrink();
    final l = AppLocalizations.of(context);
    final (bg, fg, icon, text) = switch (c.status) {
      KycStatus.verified => (SanthaColors.etaBg, SanthaColors.leaf, Icons.verified, '${l.kycVerified}${c.display != null ? ' · ${c.display}' : ''}'),
      KycStatus.failed => (SanthaColors.chilli.withValues(alpha: 0.1), SanthaColors.chilli, Icons.error_outline,
          c.failureReason != null ? l.kycFailed(c.failureReason!) : l.kycFailedGeneric),
      KycStatus.pending => (SanthaColors.marigold100, SanthaColors.ink, Icons.hourglass_top, pendingText ?? l.kycPending),
    };
    return Container(
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      padding: const EdgeInsets.all(SanthaSpacing.s4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SanthaRadius.md)),
      child: Row(children: [
        Icon(icon, color: fg),
        const SizedBox(width: SanthaSpacing.s3),
        Expanded(child: Text(text, style: TextStyle(color: fg))),
      ]),
    );
  }
}

/// Runs an async action with busy/error state for a step page.
mixin StepActions<T extends StatefulWidget> on State<T> {
  bool busy = false;
  String? error;

  Future<void> run(Future<void> Function() action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => error = AppLocalizations.of(context).apiError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

String? requiredField(AppLocalizations l, String? v) => (v == null || v.trim().isEmpty) ? l.errRequired : null;
