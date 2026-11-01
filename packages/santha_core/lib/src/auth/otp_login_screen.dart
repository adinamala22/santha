import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import 'auth_controller.dart';

/// Localised copy for [OtpLoginScreen]; each app fills it from its own ARB files (en + te).
class OtpLoginStrings {
  const OtpLoginStrings({
    required this.title,
    required this.subtitle,
    required this.phoneLabel,
    required this.phoneHint,
    required this.sendCode,
    required this.codeTitle,
    required this.codeSubtitle,
    required this.codeLabel,
    required this.verify,
    required this.resend,
    required this.resendIn,
    required this.changeNumber,
    required this.errorInvalidPhone,
    required this.errorInvalidCode,
    required this.errorWrongCode,
    required this.errorExpired,
    required this.errorTooManyAttempts,
    required this.errorRateLimited,
    required this.errorBlocked,
    required this.errorNetwork,
    required this.errorGeneric,
    required this.sessionExpired,
  });

  final String title;
  final String subtitle;
  final String phoneLabel;
  final String phoneHint;
  final String sendCode;
  final String codeTitle;

  /// e.g. "Sent to +91 98765 43210".
  final String Function(String phone) codeSubtitle;
  final String codeLabel;
  final String verify;
  final String resend;

  /// e.g. "Resend in 0:25".
  final String Function(String countdown) resendIn;
  final String changeNumber;
  final String errorInvalidPhone;
  final String errorInvalidCode;
  final String errorWrongCode;
  final String errorExpired;
  final String errorTooManyAttempts;
  final String errorRateLimited;
  final String errorBlocked;
  final String errorNetwork;
  final String errorGeneric;
  final String sessionExpired;
}

/// Two-step sign-in: Indian mobile number → 6-digit code. On success the auth controller moves to
/// [AuthSignedIn] and the app router redirects.
class OtpLoginScreen extends ConsumerStatefulWidget {
  const OtpLoginScreen({super.key, required this.strings, required this.header});

  final OtpLoginStrings strings;

  /// App-specific brand block (logo + app name) shown on the indigo header.
  final Widget header;

  @override
  ConsumerState<OtpLoginScreen> createState() => _OtpLoginScreenState();
}

class _OtpLoginScreenState extends ConsumerState<OtpLoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  OtpChallenge? _challenge;
  String? _error;
  bool _busy = false;
  int _resendLeft = 0;
  Timer? _timer;

  OtpLoginStrings get s => widget.strings;

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  String get _digits => _phone.text.replaceAll(RegExp(r'\D'), '');

  void _startCountdown(int seconds) {
    _timer?.cancel();
    setState(() => _resendLeft = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendLeft = _resendLeft > 0 ? _resendLeft - 1 : 0);
      if (_resendLeft == 0) t.cancel();
    });
  }

  String _messageFor(ApiException e) => switch (e.code) {
        'INVALID_PHONE' || 'VALIDATION_FAILED' => _challenge == null ? s.errorInvalidPhone : s.errorInvalidCode,
        'OTP_INVALID' => s.errorWrongCode,
        'OTP_EXPIRED' => s.errorExpired,
        'OTP_TOO_MANY_ATTEMPTS' => s.errorTooManyAttempts,
        'RATE_LIMITED' => s.errorRateLimited,
        'ACCOUNT_BLOCKED' => s.errorBlocked,
        ApiException.network => s.errorNetwork,
        _ => s.errorGeneric,
      };

  Future<void> _sendCode() async {
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(_digits)) {
      setState(() => _error = s.errorInvalidPhone);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final locale = Localizations.localeOf(context).languageCode;
      final ch = await ref.read(authControllerProvider.notifier).requestOtp(phone: _digits, locale: locale);
      if (!mounted) return;
      _code.clear();
      setState(() => _challenge = ch);
      _startCountdown(ch.resendAfterSec);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = _messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = s.errorInvalidCode);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).verifyOtp(challengeId: _challenge!.challengeId, code: code);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = _messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final expired = switch (ref.watch(authControllerProvider)) {
      AuthSignedOut(sessionExpired: true) => true,
      _ => false,
    };
    final onCodeStep = _challenge != null;

    return Scaffold(
      backgroundColor: SanthaColors.white,
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            Container(
              color: SanthaColors.indigo,
              padding: const EdgeInsets.fromLTRB(SanthaSpacing.s6, SanthaSpacing.s10, SanthaSpacing.s6, SanthaSpacing.s8),
              child: widget.header,
            ),
            Padding(
              padding: const EdgeInsets.all(SanthaSpacing.s6),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (expired && !onCodeStep) ...[
                      _Notice(text: s.sessionExpired),
                      const SizedBox(height: SanthaSpacing.s4),
                    ],
                    Text(onCodeStep ? s.codeTitle : s.title, style: theme.textTheme.headlineMedium),
                    const SizedBox(height: SanthaSpacing.s2),
                    Text(
                      onCodeStep ? s.codeSubtitle('+91 ${_digits.substring(0, 5)} ${_digits.substring(5)}') : s.subtitle,
                      style: theme.textTheme.bodyMedium?.copyWith(color: SanthaColors.slate),
                    ),
                    const SizedBox(height: SanthaSpacing.s8),
                    if (!onCodeStep)
                      TextField(
                        key: const ValueKey('phone'),
                        controller: _phone,
                        keyboardType: TextInputType.phone,
                        autofillHints: const [AutofillHints.telephoneNumberNational],
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _sendCode(),
                        style: theme.textTheme.titleMedium,
                        decoration: InputDecoration(
                          labelText: s.phoneLabel,
                          hintText: s.phoneHint,
                          prefixText: '+91  ',
                          contentPadding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s5, vertical: SanthaSpacing.s4),
                        ),
                      )
                    else
                      TextField(
                        key: const ValueKey('code'),
                        controller: _code,
                        keyboardType: TextInputType.number,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _verify(),
                        autofocus: true,
                        style: theme.textTheme.titleLarge?.copyWith(letterSpacing: 8),
                        decoration: InputDecoration(
                          labelText: s.codeLabel,
                          contentPadding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s5, vertical: SanthaSpacing.s4),
                        ),
                      ),
                    if (_error != null) ...[
                      const SizedBox(height: SanthaSpacing.s3),
                      Semantics(
                        liveRegion: true,
                        child: Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: SanthaColors.chilli)),
                      ),
                    ],
                    const SizedBox(height: SanthaSpacing.s6),
                    SanthaButton(
                      label: onCodeStep ? s.verify : s.sendCode,
                      loading: _busy,
                      onPressed: onCodeStep ? _verify : _sendCode,
                    ),
                    if (onCodeStep) ...[
                      const SizedBox(height: SanthaSpacing.s4),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          TextButton(
                            onPressed: _busy
                                ? null
                                : () => setState(() {
                                      _challenge = null;
                                      _error = null;
                                      _timer?.cancel();
                                    }),
                            child: Text(s.changeNumber),
                          ),
                          TextButton(
                            onPressed: _busy || _resendLeft > 0 ? null : _sendCode,
                            child: Text(
                              _resendLeft > 0
                                  ? s.resendIn('${_resendLeft ~/ 60}:${(_resendLeft % 60).toString().padLeft(2, '0')}')
                                  : s.resend,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.md)),
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s3),
          child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
        ),
      );
}
