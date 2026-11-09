import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/discovery_providers.dart';
import '../../data/format.dart';
import '../../data/order_providers.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import '../cart/cart_controller.dart';
import '../location/location_controller.dart';
import '../location/location_page.dart';
import 'bill_view.dart';
import 'payment_sheet.dart';

String? promoMessage(AppLocalizations l, PromoOutcome p) {
  if (p.applied) return null;
  return switch (p.reason) {
    'not_found' => l.promo_not_found,
    'inactive' => l.promo_inactive,
    'not_started' => l.promo_not_started,
    'expired' => l.promo_expired,
    'min_order' => l.promo_min_order(rupees(p.minOrderPaise ?? 0)),
    'first_order_only' => l.promo_first_order_only,
    'limit_reached' => l.promo_limit_reached,
    'budget_exhausted' => l.promo_budget_exhausted,
    _ => l.promo_not_applicable,
  };
}

String problemMessage(AppLocalizations l, CheckoutProblem p) => switch (p.code) {
      'EMPTY_CART' => l.problem_EMPTY_CART,
      'ITEM_UNAVAILABLE' => l.problem_ITEM_UNAVAILABLE,
      'OUT_OF_STOCK' => l.problem_OUT_OF_STOCK,
      'MAX_PER_ORDER' => l.problem_MAX_PER_ORDER(p.value ?? 0),
      'MIN_ORDER_NOT_MET' => l.problem_MIN_ORDER_NOT_MET(rupees(p.value ?? 0)),
      'NOT_DELIVERABLE' => l.problem_NOT_DELIVERABLE,
      'STORE_CLOSED' => l.problem_STORE_CLOSED,
      'SLOT_REQUIRED' => l.problem_SLOT_REQUIRED,
      'SLOT_NOT_ALLOWED' => l.problem_SLOT_NOT_ALLOWED,
      'SLOT_UNAVAILABLE' => l.problem_SLOT_UNAVAILABLE,
      'NOT_ON_MENU' => l.problem_NOT_ON_MENU,
      'DAILY_CAPACITY' => l.problem_DAILY_CAPACITY(p.value ?? 0),
      _ => l.errorGeneric,
    };

String codMessage(AppLocalizations l, CodOption c) => switch (c.reason) {
      'cooked_food' => l.cod_cooked_food,
      'type_not_allowed' => l.cod_type_not_allowed,
      'over_limit' => l.cod_over_limit(rupees(c.maxOrderPaise)),
      'too_many_open' => l.cod_too_many_open,
      _ => l.cod_disabled,
    };

/// Checkout (wireframe 05): address, delivery time, coupon, bill, payment method, place order.
/// The local cart is synced to the server, priced into a quote, and the order is placed at
/// exactly that quote (POST /orders with an Idempotency-Key kept for retries of this attempt).
/// Tip choices at checkout, in paise (ADR-032).
const tipChoices = [0, 1000, 2000, 3000, 5000];

class CheckoutPage extends ConsumerStatefulWidget {
  const CheckoutPage({super.key});

  @override
  ConsumerState<CheckoutPage> createState() => _CheckoutPageState();
}

class _CheckoutPageState extends ConsumerState<CheckoutPage> {
  String? _addressId;
  String? _promo;
  final _promoField = TextEditingController();
  final _instructions = TextEditingController();
  PaymentMethodChoice _method = PaymentMethodChoice.online;
  /// Tip for the delivery partner (ADR-032), on top of the bill; 100% to whoever delivers.
  int _tipPaise = 0;
  Checkout? _quote;
  Object? _error;
  bool _loading = true;
  bool _placing = false;
  String? _idemKey;
  String? _idemQuote;

  @override
  void initState() {
    super.initState();
    final cart = ref.read(cartControllerProvider);
    ref.read(analyticsProvider).track('checkout_started', {'merchant_id': cart.merchantId, 'items_paise': cart.totalPaise, 'item_count': cart.count});
    _addressId = ref.read(deliveryPointProvider)?.address?.id;
    WidgetsBinding.instance.addPostFrameCallback((_) => _reprice());
  }

  @override
  void dispose() {
    _promoField.dispose();
    _instructions.dispose();
    super.dispose();
  }

  DeliveryWhen _when(Cart cart) {
    final s = cart.slot;
    return s == null ? const Asap() : SlotWhen(slotId: s.slotId, date: s.date);
  }

  Future<void> _reprice({String? notice}) async {
    final cart = ref.read(cartControllerProvider);
    if (cart.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // Browsing at a GPS/map point: use a saved address only if it is that same place; otherwise the
      // customer picks one, so the bill is never for a different place than the one they browsed.
      _addressId ??= nearestSavedAddress(await ref.read(addressesProvider.future), ref.read(deliveryPointProvider)?.point)?.id;
      if (_addressId == null) {
        setState(() => _loading = false);
        return;
      }
      final api = ref.read(checkoutApiProvider);
      await api.putCart(cart.merchantId!, cart.lines.map((l) => l.toInput()).toList());
      final q = await api.price(addressId: _addressId!, when: _when(cart), promoCode: _promo);
      if (!mounted) return;
      if (_promo != null && q.promo?.applied == true) {
        ref.read(analyticsProvider).track('coupon_applied', {'code': q.promo!.code, 'discount_paise': q.promo!.discountPaise});
      }
      setState(() {
        _quote = q;
        _loading = false;
        if (!q.cod.available && _method == PaymentMethodChoice.cod) _method = PaymentMethodChoice.online;
      });
      if (notice != null) _snack(notice);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _place() async {
    final q = _quote;
    if (q == null || _placing) return;
    final l = AppLocalizations.of(context);
    // One idempotency key per quote attempt: a retry after a network error replays the same order.
    if (_idemQuote != q.quoteId) {
      _idemKey = newIdempotencyKey();
      _idemQuote = q.quoteId;
    }
    setState(() => _placing = true);
    final analytics = ref.read(analyticsProvider);
    try {
      var order = await ref.read(checkoutApiProvider).placeOrder(quoteId: q.quoteId, method: _method, idempotencyKey: _idemKey!, instructions: _instructions.text, tipPaise: _tipPaise);
      if (order.state == OrderState.awaitingPayment && order.payment != null) {
        if (!mounted) return;
        final paid = await payForOrder(context, ref, order);
        if (paid == null) {
          setState(() => _placing = false);
          return;
        }
        order = paid;
      }
      analytics.track('order_placed', {'order_id': order.id, 'merchant_id': order.merchantId, 'total_paise': order.totalPaise, 'payment_method': order.paymentMethod.name, 'promo_code': q.bill.discountCode});
      ref.read(cartControllerProvider.notifier).clear();
      ref.invalidate(ordersProvider);
      if (mounted) context.go('/orders/${order.id}?placed=1');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _placing = false);
      switch (e.code) {
        case 'QUOTE_CHANGED' || 'NOT_PLACEABLE' || 'COD_NOT_ALLOWED':
          await _reprice(notice: l.billChanged);
        case 'QUOTE_EXPIRED':
          await _reprice(notice: l.quoteExpired);
        case 'PROMO_INVALID':
          final code = _promo ?? '';
          setState(() => _promo = null);
          _promoField.clear();
          await _reprice(notice: l.couponRanOut(code));
        default:
          _snack(e.code == ApiException.network ? l.errorNetwork : (e.message ?? l.errorGeneric));
      }
    } catch (_) {
      // Anything else (e.g. the payment sheet failing): never leave the button spinning.
      if (!mounted) return;
      setState(() => _placing = false);
      _snack(l.errorGeneric);
    }
  }

  /// Adds an address on the map and, once saved, delivers this order there.
  Future<void> _addAddress() async {
    final loc = await context.push<DeliveryLocation>('/location/pin?return=1');
    ref.invalidate(addressesProvider);
    if (!mounted || loc?.address == null) return;
    setState(() => _addressId = loc!.address!.id);
    await _reprice();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final cart = ref.watch(cartControllerProvider);
    final q = _quote;
    if (cart.isEmpty) {
      return Scaffold(appBar: AppBar(title: Text(l.checkoutTitle)), body: Center(child: EmptyView(message: l.cartEmpty, icon: Icons.shopping_basket_outlined)));
    }
    final addresses = ref.watch(addressesProvider).value ?? const <Address>[];
    final address = addresses.where((a) => a.id == _addressId).firstOrNull;
    final kitchen = q?.merchantType == 'home_kitchen' || cart.slot != null;

    return Scaffold(
      backgroundColor: SanthaColors.white,
      appBar: AppBar(title: Text(l.checkoutTitle)),
      body: _error != null && q == null
          ? ErrorView(onRetry: _reprice)
          : ListView(padding: const EdgeInsets.all(SanthaSpacing.s5), children: [
              Text(cart.storeName(l.localeName), style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: SanthaSpacing.s4),
              _Section(
                title: l.deliverToAddress,
                child: address == null
                    ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        if (addresses.isNotEmpty) ...[
                          Text(l.checkoutPickAddress, key: const ValueKey('pick-address-hint'), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                          const SizedBox(height: SanthaSpacing.s2),
                          SanthaButton(key: const ValueKey('choose-address'), label: l.chooseAddress, icon: Icons.list_alt_outlined, onPressed: () => _pickAddress(addresses)),
                          const SizedBox(height: SanthaSpacing.s2),
                        ],
                        SanthaButton(key: const ValueKey('add-address'), label: l.addAddressFirst, variant: SanthaButtonVariant.outline, icon: Icons.add_location_alt_outlined, onPressed: _addAddress),
                      ])
                    : AddressTile(
                        address: address,
                        trailing: TextButton(key: const ValueKey('change-address'), onPressed: () => _pickAddress(addresses), child: Text(l.changeAddress)),
                      ),
              ),
              _Section(title: kitchen ? l.deliverySlot : l.deliveryTime, child: kitchen ? _SlotPicker(merchantId: cart.merchantId!, onChanged: () => _reprice()) : Text(l.asapLabel, style: text.bodyMedium)),
              _Section(title: l.couponLabel, child: _couponField(l, q)),
              if (q != null && q.problems.isNotEmpty) _ProblemsCard(problems: q.problems),
              if (q != null) _Section(title: l.billDetails, child: BillView(bill: q.bill, tipPaise: _tipPaise)),
              if (q != null)
                _Section(
                  title: l.paymentMethod,
                  child: RadioGroup<PaymentMethodChoice>(
                    groupValue: _method,
                    onChanged: (m) => setState(() => _method = m ?? _method),
                    child: Column(children: [
                      RadioListTile<PaymentMethodChoice>(
                        key: const ValueKey('pay-online'),
                        contentPadding: EdgeInsets.zero,
                        value: PaymentMethodChoice.online,
                        activeColor: SanthaColors.indigo,
                        title: Text(l.payOnline),
                        subtitle: Text(l.payOnlineSub),
                      ),
                      RadioListTile<PaymentMethodChoice>(
                        key: const ValueKey('pay-cod'),
                        contentPadding: EdgeInsets.zero,
                        value: PaymentMethodChoice.cod,
                        enabled: q.cod.available,
                        activeColor: SanthaColors.indigo,
                        title: Text(l.payCod),
                        subtitle: q.cod.available ? null : Text(codMessage(l, q.cod), style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
                      ),
                    ]),
                  ),
                ),
              if (q != null)
                _Section(
                  title: l.tipTitle,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l.tipNote, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                    const SizedBox(height: SanthaSpacing.s2),
                    Wrap(spacing: SanthaSpacing.s2, children: [
                      for (final t in tipChoices)
                        ChoiceChip(
                          key: ValueKey('tip-$t'),
                          label: Text(t == 0 ? l.tipNone : '+${rupees(t)}'),
                          selected: _tipPaise == t,
                          onSelected: (_) {
                            setState(() => _tipPaise = t);
                            ref.read(analyticsProvider).track('tip_selected', {'tip_paise': t});
                          },
                        ),
                    ]),
                  ]),
                ),
              TextField(
                controller: _instructions,
                maxLength: 300,
                decoration: InputDecoration(labelText: l.instructionsLabel, hintText: l.instructionsHint),
              ),
            ]),
      bottomNavigationBar: q == null
          ? (_loading ? const LinearProgressIndicator(color: SanthaColors.indigo) : null)
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s2, SanthaSpacing.s5, SanthaSpacing.s3),
                child: SanthaButton(
                  key: const ValueKey('place-order'),
                  label: _method == PaymentMethodChoice.cod ? l.placeOrderCod(rupees(q.bill.totalPaise + _tipPaise)) : l.payAndPlace(rupees(q.bill.totalPaise + _tipPaise)),
                  loading: _placing || _loading,
                  onPressed: q.placeable && address != null ? _place : null,
                ),
              ),
            ),
    );
  }

  Widget _couponField(AppLocalizations l, Checkout? q) {
    final text = Theme.of(context).textTheme;
    final applied = q?.promo?.applied == true;
    final msg = q?.promo == null ? null : promoMessage(l, q!.promo!);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(
          child: TextField(
            key: const ValueKey('coupon-field'),
            controller: _promoField,
            textCapitalization: TextCapitalization.characters,
            enabled: !applied,
            decoration: const InputDecoration(hintText: 'NELLORE50', isDense: true, prefixIcon: Icon(Icons.local_offer_outlined)),
          ),
        ),
        const SizedBox(width: SanthaSpacing.s2),
        applied
            ? TextButton(
                onPressed: () {
                  _promoField.clear();
                  setState(() => _promo = null);
                  _reprice();
                },
                child: Text(l.removeCoupon),
              )
            : TextButton(
                key: const ValueKey('apply-coupon'),
                onPressed: () {
                  final code = _promoField.text.trim();
                  if (code.isEmpty) return;
                  setState(() => _promo = code);
                  _reprice();
                },
                child: Text(l.apply),
              ),
      ]),
      if (applied) Text(l.couponApplied(q!.promo!.code, rupees(q.promo!.discountPaise)), style: text.bodySmall?.copyWith(color: SanthaColors.leaf)),
      if (msg != null) Text(msg, key: const ValueKey('coupon-error'), style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
    ]);
  }

  Future<void> _pickAddress(List<Address> addresses) async {
    final l = AppLocalizations.of(context);
    final id = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s5), children: [
          Text(l.chooseAddress, style: Theme.of(context).textTheme.titleMedium),
          for (final a in addresses) AddressTile(address: a, onTap: () => Navigator.pop(context, a.id)),
          TextButton.icon(onPressed: () => Navigator.pop(context, '__new'), icon: const Icon(Icons.add_location_alt_outlined), label: Text(l.addAddress)),
        ]),
      ),
    );
    if (!mounted || id == null) return;
    if (id == '__new') return _addAddress();
    setState(() => _addressId = id);
    await _reprice();
  }
}

/// Opens the payment sheet for an order awaiting payment. Returns the placed order, or null when the
/// customer gave up (the order then stays AWAITING_PAYMENT until it lapses, or is abandoned).
Future<Order?> payForOrder(BuildContext context, WidgetRef ref, Order order) async {
  final l = AppLocalizations.of(context);
  final analytics = ref.read(analyticsProvider);
  final api = ref.read(checkoutApiProvider);
  while (true) {
    analytics.track('payment_initiated', {'order_id': order.id, 'amount_paise': order.totalPaise, 'provider': order.payment!.provider});
    if (!context.mounted) return null;
    final outcome = await ref.read(paymentSheetProvider).pay(context, order, order.payment!);
    if (outcome is Paid) {
      // The capture is processed asynchronously (outbox → handlers): wait briefly for PLACED.
      for (var i = 0; i < 20; i++) {
        order = await api.order(order.id);
        if (order.state != OrderState.awaitingPayment) break;
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
      analytics.track('payment_succeeded', {'order_id': order.id, 'amount_paise': order.totalPaise});
      return order;
    }
    analytics.track('payment_failed', {'order_id': order.id, 'cancelled': outcome is PaymentCancelled, 'reason': outcome is PaymentFailed ? outcome.message : null});
    if (!context.mounted) return null;
    final retry = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.paymentFailedTitle),
        content: Text(l.paymentFailedBody),
        actions: [
          TextButton(key: const ValueKey('cancel-order'), onPressed: () => Navigator.pop(context, false), child: Text(l.cancelOrder)),
          FilledButton(key: const ValueKey('retry-payment'), onPressed: () => Navigator.pop(context, true), child: Text(l.tryAgainPayment)),
        ],
      ),
    );
    if (retry != true) {
      await api.abandonPayment(order.id).catchError((_) => order);
      return null;
    }
    order = await api.order(order.id);
    if (order.payment == null || order.state != OrderState.awaitingPayment) return null;
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: SanthaSpacing.s5),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s2),
          child,
        ]),
      );
}

class _ProblemsCard extends StatelessWidget {
  const _ProblemsCard({required this.problems});
  final List<CheckoutProblem> problems;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Container(
      key: const ValueKey('checkout-problems'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s5),
      padding: const EdgeInsets.all(SanthaSpacing.s4),
      decoration: BoxDecoration(color: SanthaColors.marigold100, borderRadius: BorderRadius.circular(SanthaRadius.lg)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(l.needsAttention, style: text.titleSmall),
        const SizedBox(height: SanthaSpacing.s1),
        for (final p in problems) Text('• ${problemMessage(l, p)}', style: text.bodySmall?.copyWith(color: SanthaColors.ink)),
      ]),
    );
  }
}

/// Kitchen slot chips (from the store page) — picking one writes it to the cart and re-prices.
class _SlotPicker extends ConsumerWidget {
  const _SlotPicker({required this.merchantId, required this.onChanged});
  final String merchantId;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final page = ref.watch(storePageProvider(merchantId));
    final chosen = ref.watch(cartControllerProvider.select((c) => c.slot));
    final now = DateTime.now();
    final slots = page.value?.value.slots ?? const <SlotOpening>[];
    return Wrap(spacing: SanthaSpacing.s2, runSpacing: SanthaSpacing.s2, children: [
      for (final s in slots.where((s) => s.isOpen))
        SlotChip(
          key: ValueKey('checkout-slot-${s.slotId}-${s.date}'),
          label: slotRange(s.start, s.end),
          sublabel: dayWord(l, s.date, now),
          selected: chosen?.slotId == s.slotId && chosen?.date == s.date,
          onTap: () {
            ref.read(cartControllerProvider.notifier).setSlot(merchantId, CartSlot(slotId: s.slotId, date: s.date, start: s.start));
            onChanged();
          },
        ),
    ]);
  }
}

/// The saved address at the point the customer is browsing from (within [withinM] metres), if any.
Address? nearestSavedAddress(List<Address> addresses, LatLng? at, {double withinM = 200}) {
  if (at == null) return null;
  Address? best;
  var bestM = withinM;
  for (final a in addresses) {
    final m = metresBetween(at, a.location);
    if (m <= bestM) {
      best = a;
      bestM = m;
    }
  }
  return best;
}

/// Great-circle distance in metres.
double metresBetween(LatLng a, LatLng b) {
  const r = 6371000.0;
  double rad(double d) => d * math.pi / 180;
  final dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  final h = math.pow(math.sin(dLat / 2), 2) + math.cos(rad(a.lat)) * math.cos(rad(b.lat)) * math.pow(math.sin(dLng / 2), 2);
  return 2 * r * math.asin(math.sqrt(h));
}
