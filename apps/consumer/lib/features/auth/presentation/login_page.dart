import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';

/// OTP sign-in. The flow lives in santha_core; this page supplies the app's en/te copy and header.
class LoginPage extends ConsumerWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return OtpLoginScreen(
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const SanthaLogo.reverse(width: 150),
              TextButton(
                onPressed: () => ref.read(localeControllerProvider.notifier).toggle(),
                style: TextButton.styleFrom(foregroundColor: SanthaColors.marigold, minimumSize: const Size(48, 48)),
                child: Text(l.switchLanguage),
              ),
            ],
          ),
          const SizedBox(height: SanthaSpacing.s4),
          Text(
            l.loginTagline,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(color: SanthaColors.onDarkMuted),
          ),
          const SizedBox(height: SanthaSpacing.s2),
          Text(l.loginConsent, key: const ValueKey('login-consent'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SanthaColors.onDarkMuted)),
        ],
      ),
      strings: OtpLoginStrings(
        title: l.loginTitle,
        subtitle: l.loginSubtitle,
        phoneLabel: l.phoneLabel,
        phoneHint: l.phoneHint,
        sendCode: l.sendCode,
        codeTitle: l.codeTitle,
        codeSubtitle: l.codeSubtitle,
        codeLabel: l.codeLabel,
        verify: l.verify,
        resend: l.resend,
        resendIn: l.resendIn,
        changeNumber: l.changeNumber,
        errorInvalidPhone: l.errorInvalidPhone,
        errorInvalidCode: l.errorInvalidCode,
        errorWrongCode: l.errorWrongCode,
        errorExpired: l.errorExpired,
        errorTooManyAttempts: l.errorTooManyAttempts,
        errorRateLimited: l.errorRateLimited,
        errorBlocked: l.errorBlocked,
        errorNetwork: l.errorNetwork,
        errorGeneric: l.errorGeneric,
        sessionExpired: l.sessionExpired,
      ),
    );
  }
}
