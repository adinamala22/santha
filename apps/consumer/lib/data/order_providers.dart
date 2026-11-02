import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';

import 'providers.dart';

Duration? _noRetry(int retryCount, Object error) => null;

/// The customer's orders, newest first.
final ordersProvider = FutureProvider.autoDispose<List<Order>>(retry: _noRetry, (ref) => ref.watch(checkoutApiProvider).orders());

final orderProvider = FutureProvider.autoDispose.family<Order, String>(retry: _noRetry, (ref, id) => ref.watch(checkoutApiProvider).order(id));

/// Refund credits.
final walletProvider = FutureProvider.autoDispose<Wallet>(retry: _noRetry, (ref) => ref.watch(checkoutApiProvider).wallet());
