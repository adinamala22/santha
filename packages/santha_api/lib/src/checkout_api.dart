import 'dart:math';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'dispatch.dart';
import 'money.dart';
import 'checkout_models.dart';
import 'models.dart';

/// Cart, checkout, orders, payments and wallet (M4). Errors are [ApiException]s; notable codes:
/// CART_CONFLICT (another store's cart: retry with replace), QUOTE_CHANGED / QUOTE_EXPIRED (re-price,
/// details.quoteId has the fresh quote), NOT_PLACEABLE, COD_NOT_ALLOWED, PROMO_INVALID.
class CheckoutApi {
  CheckoutApi(this.client);
  final SanthaApiClient client;
  Dio get _dio => client.dio;

  Future<ServerCart> cart() => _call(() async => ServerCart.fromJson((await _dio.get<Json>('/v1/cart')).data!));

  /// Replaces the server cart with the app's cart.
  Future<ServerCart> putCart(String merchantId, List<CartLineInput> lines, {bool replace = true}) => _call(() async {
        final r = await _dio.put<Json>('/v1/cart', data: {'merchantId': merchantId, 'lines': lines.map((l) => l.toJson()).toList(), 'replace': replace});
        return ServerCart.fromJson(r.data!);
      });

  Future<Checkout> price({required String addressId, required DeliveryWhen when, String? promoCode}) => _call(() async {
        final r = await _dio.post<Json>('/v1/cart/price', data: {
          'addressId': addressId,
          'when': when.toJson(),
          if (promoCode != null && promoCode.trim().isNotEmpty) 'promoCode': promoCode.trim(),
        });
        return Checkout.fromJson(r.data!);
      });

  /// Places the order at the quoted bill. Reuse [idempotencyKey] when retrying the same attempt.
  Future<Order> placeOrder({required String quoteId, required PaymentMethodChoice method, required String idempotencyKey, String? instructions}) => _call(() async {
        final r = await _dio.post<Json>(
          '/v1/orders',
          data: {'quoteId': quoteId, 'paymentMethod': method.name, if (instructions != null && instructions.trim().isNotEmpty) 'instructions': instructions.trim()},
          options: Options(headers: {'Idempotency-Key': idempotencyKey}),
        );
        return Order.fromJson(r.data!);
      });

  Future<List<Order>> orders() => _call(() async {
        final r = await _dio.get<Json>('/v1/orders');
        return (r.data!['items'] as List).map((o) => Order.fromJson(o as Json)).toList();
      });

  Future<Order> order(String id) => _call(() async => Order.fromJson((await _dio.get<Json>('/v1/orders/$id')).data!));

  Future<Order> abandonPayment(String orderId) => _call(() async => Order.fromJson((await _dio.post<Json>('/v1/orders/$orderId/abandon-payment')).data!));

  /// Payment sheet success callback (Razorpay: order id, payment id, signature).
  Future<PaymentCheckout> confirmPayment(String intentId, {required String providerOrderId, required String providerPaymentId, required String signature, required String idempotencyKey}) =>
      _call(() async {
        final r = await _dio.post<Json>(
          '/v1/payments/$intentId/confirm',
          data: {'providerOrderId': providerOrderId, 'providerPaymentId': providerPaymentId, 'signature': signature},
          options: Options(headers: {'Idempotency-Key': idempotencyKey}),
        );
        return PaymentCheckout.fromJson(r.data!);
      });

  /// Dev builds with PAYMENTS_PROVIDER=mock only: plays the payment sheet (succeed | fail).
  Future<PaymentCheckout> mockPay(String intentId, {required bool succeed}) => _call(() async {
        final r = await _dio.post<Json>('/v1/dev/payments/$intentId/${succeed ? 'succeed' : 'fail'}', options: SanthaApiClient.publicOptions());
        return PaymentCheckout.fromJson(r.data!);
      });

  /// Cancel before the store accepts; reason: changed_mind | ordered_by_mistake | taking_too_long | other.
  /// Online payments are refunded to the wallet at once.
  Future<Order> cancelOrder(String orderId, String reason) =>
      _call(() async => Order.fromJson((await _dio.post<Json>('/v1/orders/$orderId/cancel', data: {'reason': reason})).data!));

  /// Live delivery tracking (M6): courier, OTP, location, ETA. 404 until the store accepts.
  Future<Tracking> tracking(String orderId) => _call(() async => Tracking.fromJson((await _dio.get<Json>('/v1/orders/$orderId/tracking')).data!));

  /// No courier after the fallback ladder: cancel with a full refund.
  Future<void> cancelNoCourier(String orderId) => _call(() => _dio.post<void>('/v1/orders/$orderId/cancel-no-courier'));

  /// Report a problem with a delivered order (M7). Decided at once: auto-refunded to the wallet, waiting
  /// for review, or rejected. Errors: ISSUE_WINDOW_CLOSED (422), ALREADY_EXISTS (409).
  Future<Issue> reportIssue(String orderId, IssueType type, {List<String>? variantIds, String? description}) => _call(() async => Issue.fromJson(
      (await _dio.post<Json>('/v1/orders/$orderId/issues', data: {'type': type.wire, 'variantIds': ?variantIds, 'description': ?description})).data!));

  Future<List<Issue>> issues(String orderId) =>
      _call(() async => ((await _dio.get<Json>('/v1/orders/$orderId/issues')).data!['items'] as List).map((i) => Issue.fromJson(i as Json)).toList());

  /// Rate a delivered order once (store, and the rider when a rider delivered).
  Future<void> rate(String orderId, {required int storeStars, int? riderStars, String? comment}) =>
      _call(() => _dio.post<void>('/v1/orders/$orderId/rating', data: {'storeStars': storeStars, 'riderStars': ?riderStars, 'comment': ?comment}));

  /// Your rating of this order, or null if you have not rated it yet.
  Future<OrderRating?> myRating(String orderId) => _call(() async {
        final r = (await _dio.get<Json>('/v1/orders/$orderId/rating')).data!['rating'] as Json?;
        return r == null ? null : OrderRating.fromJson(r);
      });

  /// WhatsApp order updates (explicit opt-in, off by default).
  Future<bool> whatsappUpdates() => _call(() async => (await _dio.get<Json>('/v1/me/notification-preferences')).data!['whatsappUpdates'] as bool);

  Future<bool> setWhatsappUpdates(bool on) =>
      _call(() async => (await _dio.put<Json>('/v1/me/notification-preferences', data: {'whatsappUpdates': on})).data!['whatsappUpdates'] as bool);

  Future<Wallet> wallet() => _call(() async => Wallet.fromJson((await _dio.get<Json>('/v1/wallet')).data!));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}

/// A fresh idempotency key for one checkout attempt (keep it for retries of the same attempt).
String newIdempotencyKey() {
  final r = Random.secure();
  return 'app-${DateTime.now().millisecondsSinceEpoch}-${List.generate(12, (_) => r.nextInt(36).toRadixString(36)).join()}';
}
