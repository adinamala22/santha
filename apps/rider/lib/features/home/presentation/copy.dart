import 'package:santha_api/santha_api.dart';

import '../../../l10n/gen/app_localizations.dart';

String rupees(int paise) => paise % 100 == 0 ? '₹${paise ~/ 100}' : '₹${(paise / 100).toStringAsFixed(2)}';
String km(int metres) => '${(metres / 1000).toStringAsFixed(1)} km';
String countdown(Duration d) {
  if (d.isNegative) return '00:00';
  final s = d.inSeconds;
  return '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
}

extension RiderCopy on AppLocalizations {
  String payLine(PayLine p) => switch (p.code) {
        'base' => payBase(rupees(p.amountPaise)),
        'distance' => payDistance(rupees(p.amountPaise)),
        'wait' => payWait(rupees(p.amountPaise)),
        _ => payBatch(rupees(p.amountPaise)),
      };

  String duration(int minutes) => minutes >= 60 ? hoursMinutes(minutes ~/ 60, minutes % 60) : minutesOnly(minutes);

  String apiError(Object e) {
    if (e is! ApiException) return genericError;
    return switch (e.code) {
      ApiException.network => networkError,
      'WRONG_CODE' => wrongCode,
      'NOT_READY' => notReady,
      'OFFER_EXPIRED' => offerGone,
      _ => genericError,
    };
  }
}
