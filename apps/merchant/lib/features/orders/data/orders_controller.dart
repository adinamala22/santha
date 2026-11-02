import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

final merchantOrdersApiProvider = Provider<MerchantOrdersApi>((ref) => MerchantOrdersApi(ref.watch(apiClientProvider)));

/// How often the board refreshes when no realtime event arrives (sockets drop on poor networks).
/// Tests set null so no timer is left running.
final ordersPollEveryProvider = Provider<Duration?>((ref) => const Duration(seconds: 15));

/// Wall clock ticking once a second for countdowns; tests override with a fixed instant.
final nowTickerProvider = StreamProvider<DateTime>((ref) => Stream.periodic(const Duration(seconds: 1), (_) => DateTime.now()));

/// Rings for a new order. Tests override to count rings instead of playing sounds.
final orderAlertProvider = Provider<void Function()>((ref) => () {
      SystemSound.play(SystemSoundType.alert);
      HapticFeedback.heavyImpact();
    });

class OrdersBoard {
  const OrdersBoard({required this.tab, required this.newOrders, required this.list, this.deliveries = const {}});
  /// The selected tab below the new-order cards (never [OrderBucket.newOrders]).
  final OrderBucket tab;
  final List<MerchantOrder> newOrders;
  final MerchantOrderList list;
  /// Active deliveries by order id (M6): pickup code, courier, staff link, fallback bonus.
  final Map<String, MerchantDelivery> deliveries;

  int count(OrderBucket b) => list.counts[b] ?? 0;
  OrdersBoard copyWith({OrderBucket? tab, List<MerchantOrder>? newOrders, MerchantOrderList? list}) =>
      OrdersBoard(tab: tab ?? this.tab, newOrders: newOrders ?? this.newOrders, list: list ?? this.list, deliveries: deliveries);
}

/// The merchant's live order board: new orders waiting for a decision on top, then one tab.
/// Refreshes on realtime events (order.new / order.updated / store.paused) and by polling.
final ordersBoardProvider = AsyncNotifierProvider<OrdersBoardController, OrdersBoard>(OrdersBoardController.new);

class OrdersBoardController extends AsyncNotifier<OrdersBoard> {
  MerchantOrdersApi get _api => ref.read(merchantOrdersApiProvider);
  Analytics get _analytics => ref.read(analyticsProvider);
  Timer? _poll;
  final _rung = <String>{};

  @override
  Future<OrdersBoard> build() async {
    final every = ref.watch(ordersPollEveryProvider);
    if (every != null) {
      _poll = Timer.periodic(every, (_) => reload());
      ref.onDispose(() => _poll?.cancel());
    }
    ref.listen(realtimeEventsProvider, (_, next) {
      if (next.hasValue) reload();
    });
    return _load(OrderBucket.preparing);
  }

  Future<OrdersBoard> _load(OrderBucket tab) async {
    final (results, deliveries) = await (Future.wait([_api.list(OrderBucket.newOrders), _api.list(tab)]), _api.deliveries().catchError((_) => <MerchantDelivery>[])).wait;
    final fresh = results[0].items.where((o) => !_rung.contains(o.id)).toList();
    if (fresh.isNotEmpty) {
      _rung.addAll(fresh.map((o) => o.id));
      ref.read(orderAlertProvider)();
    }
    return OrdersBoard(tab: tab, newOrders: results[0].items, list: results[1], deliveries: {for (final d in deliveries) d.orderId: d});
  }

  Future<void> reload() async {
    final tab = state.value?.tab ?? OrderBucket.preparing;
    final next = await AsyncValue.guard(() => _load(tab));
    // Keep showing the last board if a background refresh fails.
    if (next.hasValue || state.value == null) state = next;
  }

  Future<void> selectTab(OrderBucket tab) async {
    final cur = state.value;
    if (cur != null) state = AsyncData(cur.copyWith(tab: tab));
    final list = await _api.list(tab);
    state = AsyncData((state.value ?? cur!).copyWith(tab: tab, list: list));
  }

  /// Accept with the fulfilment choice (M6): self (a staff member, or the owner when [staffId] is null) or rider.
  Future<void> accept(MerchantOrder o, {FulfilmentMode? mode, String? staffId}) async {
    await _act(() => _api.accept(o.id, mode: mode, staffId: staffId));
    _analytics.track('order_accepted', {'order_id': o.id});
    if (mode != null) _analytics.track('fulfilment_choice', {'order_id': o.id, 'mode': mode.name, 'staff': staffId != null});
  }

  /// No rider yet (fallback bonus offered): the store delivers after all.
  Future<void> deliverMyself(String orderId, {String? staffId}) async {
    await _act(() => _api.deliverMyself(orderId, staffId: staffId));
    _analytics.track('fulfilment_choice', {'order_id': orderId, 'mode': 'self', 'after_fallback': true});
  }

  Future<void> reject(MerchantOrder o, String reason) async {
    await _act(() => _api.reject(o.id, reason));
    _analytics.track('order_rejected', {'order_id': o.id, 'reason': reason});
  }

  Future<void> markReady(MerchantOrder o) async {
    await _act(() => _api.ready(o.id));
    _analytics.track('order_marked_ready', {'order_id': o.id});
  }

  Future<MerchantOrder> removeItem(MerchantOrder o, MerchantOrderLine line) async {
    final r = await _act(() => _api.removeItem(o.id, line.variantId));
    _analytics.track('order_item_unavailable', {'order_id': o.id, 'action': 'remove'});
    return r;
  }

  Future<MerchantOrder> substitute(MerchantOrder o, MerchantOrderLine line, Item item, Variant v) async {
    final r = await _act(() => _api.substituteItem(o.id, line.variantId, withItemId: item.id, withVariantId: v.id!));
    _analytics.track('order_item_unavailable', {'order_id': o.id, 'action': 'substitute'});
    return r;
  }

  /// Runs an order action, then refreshes the board. INVALID_STATE (someone else moved the order
  /// on, e.g. the accept window expired) still refreshes before rethrowing.
  Future<T> _act<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } finally {
      await reload();
    }
  }
}

/// Store Open / Paused toggle; null until changed here or by a realtime store.paused (then the
/// value from GET /merchants/me applies).
final storeOpenProvider = NotifierProvider<StoreOpenController, bool?>(StoreOpenController.new);

class StoreOpenController extends Notifier<bool?> {
  @override
  bool? build() {
    ref.listen(realtimeEventsProvider, (_, next) {
      if (next.value?.name == 'store.paused') state = false;
    });
    return null;
  }

  Future<void> set(bool open) async {
    final before = state;
    state = open;
    try {
      final v = await ref.read(merchantOrdersApiProvider).setAvailability(open);
      state = v.merchant.acceptingOrders;
      ref.read(analyticsProvider).track('store_availability_changed', {'open': open});
    } catch (_) {
      state = before;
      rethrow;
    }
  }
}

/// Statement preview for today (M6): delivered orders with commission and delivery-fee credit.
final statementPreviewProvider = FutureProvider.autoDispose<StatementPreview>((ref) => ref.watch(merchantOrdersApiProvider).statementPreview());
