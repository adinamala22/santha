import 'dart:convert';
import 'dart:io';

import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// Contract: the M4 models parse real responses captured from `pnpm dev:fake`.
void main() {
  test('cart: one store, lines with substitution preference', () {
    final c = ServerCart.fromJson(fixture('cart'));
    expect(c.merchantName, 'Ramesh Stores');
    expect(c.lines.first.substitution, Substitution.similar);
    expect(c.itemsPaise, c.lines.fold<int>(0, (s, l) => s + l.linePaise));
  });

  test('retail checkout: bill adds up, promo applied, COD available', () {
    final q = Checkout.fromJson(fixture('checkout_retail'));
    final b = q.bill;
    final fees = b.fees.fold<int>(0, (s, f) => s + f.amountPaise);
    final taxes = b.taxes.fold<int>(0, (s, t) => s + t.amountPaise);
    expect(b.totalPaise, b.itemsPaise + fees + taxes - b.discountPaise);
    expect(q.promo!.applied, isTrue);
    expect(b.discountCode, 'TINY');
    expect(q.cod.available, isTrue);
    expect(q.placeable, isTrue);
    expect(b.fees.map((f) => f.code), contains(FeeCode.platform));
  });

  test('kitchen checkout: slot time, 5% GST on food, no COD for cooked food', () {
    final q = Checkout.fromJson(fixture('checkout_kitchen'));
    expect(q.merchantType, 'home_kitchen');
    expect(q.slotStartsAt, isNotNull);
    expect(q.bill.taxes.any((t) => t.cookedFood && t.ratePercent == 5), isTrue);
    expect(q.cod.available, isFalse);
    expect(q.cod.reason, 'cooked_food');
  });

  test('order: awaiting payment carries the payment sheet; placed has history', () {
    final waiting = Order.fromJson(fixture('order_awaiting_payment'));
    expect(waiting.state, OrderState.awaitingPayment);
    expect(waiting.payment!.isMock, isTrue);
    expect(waiting.payment!.amountPaise, waiting.totalPaise);
    expect(waiting.instructions, 'Ring the bell twice');
    final placed = Order.fromJson(fixture('order_placed'));
    expect(placed.state, OrderState.placed);
    expect(placed.history.map((h) => h.state), [OrderState.awaitingPayment, OrderState.placed]);
    expect(placed.payment!.status, 'captured');
    expect(placed.code, startsWith('SN'));
    final list = (fixture('order_list')['items'] as List).map((o) => Order.fromJson(o as Map<String, dynamic>)).toList();
    expect(list.first.id, placed.id);
  });

  test('wallet', () {
    final w = Wallet.fromJson(fixture('wallet'));
    expect(w.balancePaise, w.entries.fold<int>(0, (s, e) => s + e.amountPaise));
  });

  test('request bodies', () {
    expect(const SlotWhen(slotId: 's', date: '2026-11-06').toJson(), {'mode': 'slot', 'slotId': 's', 'date': '2026-11-06'});
    expect(const CartLineInput(itemId: 'i', variantId: 'v', quantity: 2).toJson()['substitution'], 'call_me');
    expect(newIdempotencyKey(), matches(RegExp(r'^[A-Za-z0-9_:.-]{8,100}$')));
  });
}
