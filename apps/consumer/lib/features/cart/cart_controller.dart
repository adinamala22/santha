import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

/// One line of the local cart. Prices are what the customer saw; M4 re-prices on the server.
class CartLine {
  const CartLine({
    required this.itemId,
    required this.variantId,
    required this.name,
    required this.variantLabel,
    required this.pricePaise,
    required this.quantity,
    this.nameTe,
    this.maxPerOrder,
    this.substitution = Substitution.callMe,
  });

  factory CartLine.fromJson(Json j) => CartLine(
        itemId: j['itemId'] as String,
        variantId: j['variantId'] as String,
        name: j['name'] as String,
        variantLabel: j['variantLabel'] as String,
        pricePaise: j['pricePaise'] as int,
        quantity: j['quantity'] as int,
        nameTe: j['nameTe'] as String?,
        maxPerOrder: j['maxPerOrder'] as int?,
        substitution: Substitution.parse(j['substitution'] as String?),
      );

  final String itemId;
  final String variantId;
  final String name;
  final String? nameTe;
  final String variantLabel;
  final int pricePaise;
  final int quantity;
  final int? maxPerOrder;

  String displayName(String lang) => lang == 'te' && nameTe != null ? nameTe! : name;

  /// What the store should do if this item is unavailable when packing.
  final Substitution substitution;

  int get totalPaise => pricePaise * quantity;

  CartLine withQuantity(int q) => CartLine(
        itemId: itemId,
        variantId: variantId,
        name: name,
        nameTe: nameTe,
        variantLabel: variantLabel,
        pricePaise: pricePaise,
        quantity: q,
        maxPerOrder: maxPerOrder,
        substitution: substitution,
      );

  CartLine withSubstitution(Substitution s) => CartLine(
        itemId: itemId,
        variantId: variantId,
        name: name,
        nameTe: nameTe,
        variantLabel: variantLabel,
        pricePaise: pricePaise,
        quantity: quantity,
        maxPerOrder: maxPerOrder,
        substitution: s,
      );

  CartLineInput toInput() => CartLineInput(itemId: itemId, variantId: variantId, quantity: quantity, substitution: substitution);

  Json toJson() => {
        'itemId': itemId,
        'variantId': variantId,
        'name': name,
        'nameTe': nameTe,
        'variantLabel': variantLabel,
        'pricePaise': pricePaise,
        'quantity': quantity,
        'maxPerOrder': maxPerOrder,
        'substitution': substitution.wire,
      };
}

/// Home-kitchen delivery slot picked for the cart.
class CartSlot {
  const CartSlot({required this.slotId, required this.date, required this.start});
  factory CartSlot.fromJson(Json j) => CartSlot(slotId: j['slotId'] as String, date: j['date'] as String, start: j['start'] as String);
  final String slotId;
  final String date;
  final String start;
  Json toJson() => {'slotId': slotId, 'date': date, 'start': start};
  @override
  bool operator ==(Object other) => other is CartSlot && other.slotId == slotId && other.date == date;
  @override
  int get hashCode => Object.hash(slotId, date);
}

/// A single-store cart (multi-store carts are Phase 2). Totals are always recomputed from lines.
class Cart {
  const Cart({this.merchantId, this.merchantName, this.merchantNameTe, this.lines = const [], this.slot});

  factory Cart.fromJson(Json j) => Cart(
        merchantId: j['merchantId'] as String?,
        merchantName: j['merchantName'] as String?,
        merchantNameTe: j['merchantNameTe'] as String?,
        lines: ((j['lines'] as List?) ?? const []).map((l) => CartLine.fromJson(l as Json)).toList(),
        slot: j['slot'] == null ? null : CartSlot.fromJson(j['slot'] as Json),
      );

  static const empty = Cart();

  final String? merchantId;
  final String? merchantName;
  final String? merchantNameTe;
  final List<CartLine> lines;

  /// The store's name in the app language ('' when the cart is empty).
  String storeName(String lang) => (lang == 'te' ? merchantNameTe : null) ?? merchantName ?? '';
  final CartSlot? slot;

  bool get isEmpty => lines.isEmpty;
  int get count => lines.fold(0, (n, l) => n + l.quantity);
  int get totalPaise => lines.fold(0, (n, l) => n + l.totalPaise);
  int quantityOf(String variantId) => lines.where((l) => l.variantId == variantId).fold(0, (n, l) => n + l.quantity);
  int quantityOfItem(String itemId) => lines.where((l) => l.itemId == itemId).fold(0, (n, l) => n + l.quantity);

  Json toJson() => {'merchantId': merchantId, 'merchantName': merchantName, 'merchantNameTe': merchantNameTe, 'lines': lines.map((l) => l.toJson()).toList(), 'slot': slot?.toJson()};
}

enum AddOutcome { added, otherStore, maxReached }

/// What is being added: enough to build a line without the full catalogue.
class CartAdd {
  const CartAdd({
    required this.merchantId,
    required this.merchantName,
    required this.itemId,
    required this.variantId,
    required this.name,
    required this.variantLabel,
    required this.pricePaise,
    this.merchantNameTe,
    this.nameTe,
    this.maxPerOrder,
  });

  factory CartAdd.fromCard(ItemCard i, StoreSummary store, {int? maxPerOrder}) => CartAdd(
        merchantId: store.id,
        merchantName: store.name,
        merchantNameTe: store.nameTe,
        itemId: i.id,
        variantId: i.variantId,
        name: i.name,
        nameTe: i.nameTe,
        variantLabel: i.variantLabel,
        pricePaise: i.pricePaise,
        maxPerOrder: maxPerOrder,
      );

  final String merchantId;
  final String merchantName;
  final String? merchantNameTe;
  final String itemId;
  final String variantId;
  final String name;
  final String? nameTe;
  final String variantLabel;
  final int pricePaise;
  final int? maxPerOrder;
}

/// The local cart, persisted on the device until M4 moves carts to the server.
final cartControllerProvider = NotifierProvider<CartController, Cart>(CartController.new);

class CartController extends Notifier<Cart> {
  static const _key = 'santha.cart';

  /// Bumped by [clear]: a restore still reading from storage must not bring the old cart back.
  int _epoch = 0;

  @override
  Cart build() {
    _restore();
    return Cart.empty;
  }

  Future<void> _restore() async {
    final epoch = _epoch;
    final raw = await ref.read(keyValueStoreProvider).read(_key);
    if (raw == null || epoch != _epoch) return;
    try {
      final saved = Cart.fromJson(jsonDecode(raw) as Json);
      if (state.isEmpty) state = saved;
    } catch (_) {}
  }

  /// [source] is for analytics: search, store, sheet.
  AddOutcome add(CartAdd a, {required String source, bool replace = false}) {
    var cart = state;
    if (!cart.isEmpty && cart.merchantId != a.merchantId) {
      if (!replace) return AddOutcome.otherStore;
      cart = Cart.empty;
    }
    if (a.maxPerOrder != null && cart.quantityOfItem(a.itemId) >= a.maxPerOrder!) return AddOutcome.maxReached;
    final i = cart.lines.indexWhere((l) => l.variantId == a.variantId);
    final lines = [...cart.lines];
    if (i >= 0) {
      lines[i] = lines[i].withQuantity(lines[i].quantity + 1);
    } else {
      lines.add(CartLine(
        itemId: a.itemId,
        variantId: a.variantId,
        name: a.name,
        nameTe: a.nameTe,
        variantLabel: a.variantLabel,
        pricePaise: a.pricePaise,
        quantity: 1,
        maxPerOrder: a.maxPerOrder,
      ));
    }
    _save(Cart(merchantId: a.merchantId, merchantName: a.merchantName, merchantNameTe: a.merchantNameTe, lines: lines, slot: cart.merchantId == a.merchantId ? cart.slot : null));
    ref.read(analyticsProvider).track('add_to_cart', {
      'merchant_id': a.merchantId,
      'item_id': a.itemId,
      'variant_id': a.variantId,
      'price_paise': a.pricePaise,
      'source': source,
      'cart_count': state.count,
    });
    return AddOutcome.added;
  }

  void remove(String variantId) {
    final lines = [
      for (final l in state.lines)
        if (l.variantId != variantId) l else if (l.quantity > 1) l.withQuantity(l.quantity - 1),
    ];
    _save(lines.isEmpty ? Cart.empty : Cart(merchantId: state.merchantId, merchantName: state.merchantName, merchantNameTe: state.merchantNameTe, lines: lines, slot: state.slot));
  }

  void setSlot(String merchantId, CartSlot slot) {
    if (!state.isEmpty && state.merchantId != merchantId) return;
    _save(Cart(merchantId: state.merchantId ?? merchantId, merchantName: state.merchantName, merchantNameTe: state.merchantNameTe, lines: state.lines, slot: slot));
  }

  void setSubstitution(String variantId, Substitution s) {
    _save(Cart(
      merchantId: state.merchantId,
      merchantName: state.merchantName, merchantNameTe: state.merchantNameTe,
      lines: [for (final l in state.lines) l.variantId == variantId ? l.withSubstitution(s) : l],
      slot: state.slot,
    ));
  }

  void clear() {
    _epoch++;
    _save(Cart.empty);
  }

  void _save(Cart c) {
    state = c;
    ref.read(keyValueStoreProvider).write(_key, jsonEncode(c.toJson()));
  }
}
