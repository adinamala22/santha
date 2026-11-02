import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';

import 'providers.dart';

Duration? _noRetry(int retryCount, Object error) => null;

/// The customer's orders, newest first.
final ordersProvider = FutureProvider.autoDispose<List<Order>>(retry: _noRetry, (ref) => ref.watch(checkoutApiProvider).orders());

final orderProvider = FutureProvider.autoDispose.family<Order, String>(retry: _noRetry, (ref, id) => ref.watch(checkoutApiProvider).order(id));

/// Refund credits.
final walletProvider = FutureProvider.autoDispose<Wallet>(retry: _noRetry, (ref) => ref.watch(checkoutApiProvider).wallet());

/// How often an open order screen re-checks a moving order (realtime is the fast path).
final orderPollEveryProvider = Provider<Duration?>((ref) => const Duration(seconds: 20));

/// WhatsApp order updates opt-in (off by default).
final whatsappUpdatesProvider = FutureProvider.autoDispose<bool>(retry: _noRetry, (ref) => ref.watch(checkoutApiProvider).whatsappUpdates());
