import 'dart:math';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
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
