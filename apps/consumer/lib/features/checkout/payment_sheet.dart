import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../data/format.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';

sealed class PaymentOutcome {
  const PaymentOutcome();
}

class Paid extends PaymentOutcome {
  const Paid();
}

class PaymentFailed extends PaymentOutcome {
  const PaymentFailed(this.message);
  final String? message;
}

class PaymentCancelled extends PaymentOutcome {
  const PaymentCancelled();
}

/// Opens the payment sheet for an order awaiting payment and reports the outcome. A success is
/// confirmed with the backend (signature checked there) before it is reported as [Paid].
abstract interface class PaymentSheet {
  Future<PaymentOutcome> pay(BuildContext context, Order order, PaymentCheckout payment);
}

/// Picks the sheet the backend asked for: Razorpay checkout, or the test sheet for the mock provider.
final paymentSheetProvider = Provider<PaymentSheet>((ref) => _RoutingSheet(ref));

class _RoutingSheet implements PaymentSheet {
  _RoutingSheet(this.ref);
  final Ref ref;

  @override
  Future<PaymentOutcome> pay(BuildContext context, Order order, PaymentCheckout payment) =>
      (payment.isMock ? MockPaymentSheet(ref.read(checkoutApiProvider)) : RazorpayPaymentSheet(ref.read(checkoutApiProvider))).pay(context, order, payment);
}

/// Razorpay Standard Checkout (UPI intent, cards, net banking). Test-mode keys = sandbox.
class RazorpayPaymentSheet implements PaymentSheet {
  RazorpayPaymentSheet(this.api);
  final CheckoutApi api;

  @override
  Future<PaymentOutcome> pay(BuildContext context, Order order, PaymentCheckout payment) async {
    final done = Completer<PaymentOutcome>();
    final razorpay = Razorpay();
    final key = newIdempotencyKey();
    razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) async {
      try {
        await api.confirmPayment(payment.intentId, providerOrderId: r.orderId ?? payment.providerOrderId, providerPaymentId: r.paymentId ?? '', signature: r.signature ?? '', idempotencyKey: key, tip: payment.tip);
        if (!done.isCompleted) done.complete(const Paid());
      } on ApiException catch (e) {
        if (!done.isCompleted) done.complete(PaymentFailed(e.message));
      }
    });
    razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) {
      if (!done.isCompleted) done.complete(r.code == Razorpay.PAYMENT_CANCELLED ? const PaymentCancelled() : PaymentFailed(r.message));
    });
    razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse _) {});
    final indigo = SanthaColors.indigo.toARGB32().toRadixString(16).padLeft(8, '0').substring(2);
    razorpay.open({
      'key': payment.keyId,
      'order_id': payment.providerOrderId,
      'amount': payment.amountPaise,
      'currency': payment.currency,
      'name': 'Santha',
      'description': order.code,
      'theme': {'color': '#$indigo'},
    });
    final outcome = await done.future;
    razorpay.clear();
    return outcome;
  }
}

/// Dev builds against PAYMENTS_PROVIDER=mock: pay or fail through the backend's mock gateway.
class MockPaymentSheet implements PaymentSheet {
  MockPaymentSheet(this.api);
  final CheckoutApi api;

  @override
  Future<PaymentOutcome> pay(BuildContext context, Order order, PaymentCheckout payment) async {
    final choice = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        final l = AppLocalizations.of(context);
        final text = Theme.of(context).textTheme;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, 0, SanthaSpacing.s5, SanthaSpacing.s5),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l.testPaymentTitle, style: text.titleLarge),
              const SizedBox(height: SanthaSpacing.s1),
              Text(l.testPaymentBody, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
              const SizedBox(height: SanthaSpacing.s4),
              SanthaButton(key: const ValueKey('mock-pay'), label: l.payNow(rupees(payment.amountPaise)), onPressed: () => Navigator.pop(context, true)),
              const SizedBox(height: SanthaSpacing.s2),
              SanthaButton(key: const ValueKey('mock-fail'), label: l.failPayment, variant: SanthaButtonVariant.outline, onPressed: () => Navigator.pop(context, false)),
            ]),
          ),
        );
      },
    );
    if (choice == null) return const PaymentCancelled();
    try {
      final p = await api.mockPay(payment.intentId, succeed: choice, tip: payment.tip);
      return p.status == 'captured' ? const Paid() : PaymentFailed(p.lastFailure);
    } on ApiException catch (e) {
      return PaymentFailed(e.message);
    }
  }
}
