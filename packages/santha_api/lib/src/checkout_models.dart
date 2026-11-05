// Cart, checkout, order and payment models mirroring apps/backend/openapi.json (CartDto,
// CheckoutDto, OrderDto, PaymentDto, WalletDto). Hand-written like the other models; contract tests
// parse responses captured from `pnpm dev:fake` (test/fixtures).
import 'catalogue_models.dart';
import 'models.dart';

List<T> _list<T>(Object? v, T Function(Json) f) => ((v as List?) ?? const []).map((e) => f(e as Json)).toList();
FoodMark? _foodMark(Object? v) => v == null ? null : FoodMark.values.firstWhere((f) => f.wire == v);
DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);

/// What to do if an item is unavailable when the store packs the order.
enum Substitution {
  callMe('call_me'),
  similar('similar'),
  remove('remove');

  const Substitution(this.wire);
  final String wire;
  static Substitution parse(String? s) => values.firstWhere((v) => v.wire == s, orElse: () => callMe);
}

/// A line to send with PUT /v1/cart.
class CartLineInput {
  const CartLineInput({required this.itemId, required this.variantId, required this.quantity, this.substitution = Substitution.callMe});
  final String itemId;
  final String variantId;
  final int quantity;
  final Substitution substitution;
  Json toJson() => {'itemId': itemId, 'variantId': variantId, 'quantity': quantity, 'substitution': substitution.wire};
}

class ServerCartLine {
  const ServerCartLine({
    required this.itemId,
    required this.variantId,
    required this.name,
    required this.variantLabel,
    required this.quantity,
    required this.unitPricePaise,
    required this.linePaise,
    required this.stock,
    required this.available,
    required this.substitution,
    this.nameTe,
    this.mrpPaise,
    this.maxPerOrder,
    this.imageUrl,
    this.foodMark,
  });

  factory ServerCartLine.fromJson(Json j) => ServerCartLine(
        itemId: j['itemId'] as String,
        variantId: j['variantId'] as String,
        name: j['name'] as String,
        nameTe: j['nameTe'] as String?,
        variantLabel: j['variantLabel'] as String,
        quantity: j['quantity'] as int,
        unitPricePaise: j['unitPricePaise'] as int,
        mrpPaise: j['mrpPaise'] as int?,
        linePaise: j['linePaise'] as int,
        stock: StockWire.parse(j['stock'] as String),
        available: j['available'] as bool,
        maxPerOrder: j['maxPerOrder'] as int?,
        substitution: Substitution.parse(j['substitution'] as String?),
        imageUrl: j['imageUrl'] as String?,
        foodMark: _foodMark(j['foodMark']),
      );

  final String itemId;
  final String variantId;
  final String name;
  final String? nameTe;
  final String variantLabel;
  final int quantity;
  final int unitPricePaise;
  final int? mrpPaise;
  final int linePaise;
  final StockState stock;
  final bool available;
  final int? maxPerOrder;
  final Substitution substitution;
  final String? imageUrl;
  final FoodMark? foodMark;
}

class ServerCart {
  const ServerCart({required this.lines, required this.itemsPaise, required this.itemCount, this.merchantId, this.merchantName});
  factory ServerCart.fromJson(Json j) => ServerCart(
        merchantId: (j['merchant'] as Json?)?['id'] as String?,
        merchantName: (j['merchant'] as Json?)?['name'] as String?,
        lines: _list(j['lines'], ServerCartLine.fromJson),
        itemsPaise: j['itemsPaise'] as int,
        itemCount: j['itemCount'] as int,
      );
  final String? merchantId;
  final String? merchantName;
  final List<ServerCartLine> lines;
  final int itemsPaise;
  final int itemCount;
}

/// Delivery time chosen at checkout.
sealed class DeliveryWhen {
  const DeliveryWhen();
  Json toJson();
}

class Asap extends DeliveryWhen {
  const Asap();
  @override
  Json toJson() => {'mode': 'asap'};
}

class SlotWhen extends DeliveryWhen {
  const SlotWhen({required this.slotId, required this.date});
  final String slotId;
  final String date;
  @override
  Json toJson() => {'mode': 'slot', 'slotId': slotId, 'date': date};
}

enum FeeCode { delivery, beyondRadius, smallOrder, platform, packaging }

FeeCode _fee(String s) => switch (s) {
      'delivery' => FeeCode.delivery,
      'beyond_radius' => FeeCode.beyondRadius,
      'small_order' => FeeCode.smallOrder,
      'platform' => FeeCode.platform,
      _ => FeeCode.packaging,
    };

class FeeRow {
  const FeeRow(this.code, this.amountPaise, this.waivedPaise);
  factory FeeRow.fromJson(Json j) => FeeRow(_fee(j['code'] as String), j['amountPaise'] as int, j['waivedPaise'] as int);
  final FeeCode code;
  final int amountPaise;
  final int waivedPaise;
}

class TaxRow {
  const TaxRow({required this.cookedFood, required this.ratePercent, required this.amountPaise});
  factory TaxRow.fromJson(Json j) => TaxRow(cookedFood: j['code'] == 'gst_food', ratePercent: j['ratePercent'] as int, amountPaise: j['amountPaise'] as int);
  final bool cookedFood;
  final int ratePercent;
  final int amountPaise;
}

class BillLine {
  const BillLine({
    required this.itemId,
    required this.variantId,
    required this.name,
    required this.variantLabel,
    required this.quantity,
    required this.unitPricePaise,
    required this.linePaise,
    required this.available,
    required this.stock,
    this.nameTe,
    this.mrpPaise,
  });
  factory BillLine.fromJson(Json j) => BillLine(
        itemId: j['itemId'] as String,
        variantId: j['variantId'] as String,
        name: j['name'] as String,
        nameTe: j['nameTe'] as String?,
        variantLabel: j['variantLabel'] as String,
        quantity: j['quantity'] as int,
        unitPricePaise: j['unitPricePaise'] as int,
        mrpPaise: j['mrpPaise'] as int?,
        linePaise: j['linePaise'] as int,
        available: j['available'] as bool? ?? true,
        stock: StockWire.parse((j['stock'] as String?) ?? 'in'),
      );
  final String itemId;
  final String variantId;
  final String name;
  final String? nameTe;
  final String variantLabel;
  final int quantity;
  final int unitPricePaise;
  final int? mrpPaise;
  final int linePaise;
  final bool available;
  final StockState stock;
}

/// The bill (computeQuote result): every total is recomputed by the server from lines and fee rows.
class Bill {
  const Bill({
    required this.lines,
    required this.itemsPaise,
    required this.mrpSavingsPaise,
    required this.fees,
    required this.taxes,
    required this.discountPaise,
    required this.totalPaise,
    required this.toFreeDeliveryPaise,
    this.discountCode,
  });
  factory Bill.fromJson(Json j) => Bill(
        lines: _list(j['lines'], BillLine.fromJson),
        itemsPaise: j['itemsPaise'] as int,
        mrpSavingsPaise: j['mrpSavingsPaise'] as int,
        fees: _list(j['fees'], FeeRow.fromJson),
        taxes: _list(j['taxes'], TaxRow.fromJson),
        discountPaise: j['discountPaise'] as int,
        discountCode: (j['discount'] as Json?)?['code'] as String?,
        totalPaise: j['totalPaise'] as int,
        toFreeDeliveryPaise: j['toFreeDeliveryPaise'] as int? ?? 0,
      );
  final List<BillLine> lines;
  final int itemsPaise;
  final int mrpSavingsPaise;
  final List<FeeRow> fees;
  final List<TaxRow> taxes;
  final int discountPaise;
  final String? discountCode;
  final int totalPaise;
  final int toFreeDeliveryPaise;
}

/// Why something blocks placing the order (codes from the backend).
class CheckoutProblem {
  const CheckoutProblem(this.code, {this.itemId, this.value, this.at});
  factory CheckoutProblem.fromJson(Json j) => CheckoutProblem(j['code'] as String, itemId: j['itemId'] as String?, value: j['value'] as int?, at: _date(j['at']));
  final String code;
  final String? itemId;
  final int? value;
  final DateTime? at;
}

class PromoOutcome {
  const PromoOutcome({required this.code, required this.applied, required this.discountPaise, this.reason, this.description, this.descriptionTe, this.minOrderPaise});
  factory PromoOutcome.fromJson(Json j) => PromoOutcome(
        code: j['code'] as String,
        applied: j['applied'] as bool,
        reason: j['reason'] as String?,
        description: j['description'] as String?,
        descriptionTe: j['descriptionTe'] as String?,
        discountPaise: j['discountPaise'] as int,
        minOrderPaise: j['minOrderPaise'] as int?,
      );
  final String code;
  final bool applied;
  final String? reason;
  final String? description;
  final String? descriptionTe;
  final int discountPaise;
  final int? minOrderPaise;
}

class CodOption {
  const CodOption({required this.available, required this.maxOrderPaise, this.reason});
  final bool available;
  final String? reason;
  final int maxOrderPaise;
}

class Checkout {
  const Checkout({
    required this.quoteId,
    required this.expiresAt,
    required this.merchantId,
    required this.merchantName,
    required this.merchantType,
    required this.bill,
    required this.problems,
    required this.placeable,
    required this.cod,
    this.merchantNameTe,
    this.promo,
    this.slotStartsAt,
  });
  factory Checkout.fromJson(Json j) {
    final m = j['merchant'] as Json;
    final cod = (j['payment'] as Json)['cod'] as Json;
    return Checkout(
      quoteId: j['quoteId'] as String,
      expiresAt: DateTime.parse(j['expiresAt'] as String),
      merchantId: m['id'] as String,
      merchantName: m['name'] as String,
      merchantNameTe: m['nameTe'] as String?,
      merchantType: m['type'] as String,
      bill: Bill.fromJson(j['bill'] as Json),
      promo: j['promo'] == null ? null : PromoOutcome.fromJson(j['promo'] as Json),
      problems: _list(j['problems'], CheckoutProblem.fromJson),
      placeable: j['placeable'] as bool,
      cod: CodOption(available: cod['available'] as bool, reason: cod['reason'] as String?, maxOrderPaise: cod['maxOrderPaise'] as int),
      slotStartsAt: _date((j['when'] as Json)['startsAt']),
    );
  }
  final String quoteId;
  final DateTime expiresAt;
  final String merchantId;
  final String merchantName;
  final String? merchantNameTe;
  final String merchantType;
  final Bill bill;
  final PromoOutcome? promo;
  final List<CheckoutProblem> problems;
  final bool placeable;
  final CodOption cod;
  final DateTime? slotStartsAt;
}

enum PaymentMethodChoice { online, cod }

/// What the payment sheet needs (Razorpay checkout, or the dev mock sheet).
class PaymentCheckout {
  const PaymentCheckout({
    required this.intentId,
    required this.provider,
    required this.providerOrderId,
    required this.amountPaise,
    required this.currency,
    required this.status,
    this.keyId,
    this.lastFailure,
  });
  factory PaymentCheckout.fromJson(Json j) => PaymentCheckout(
        intentId: j['intentId'] as String,
        provider: j['provider'] as String,
        providerOrderId: j['providerOrderId'] as String,
        keyId: j['keyId'] as String?,
        amountPaise: j['amountPaise'] as int,
        currency: j['currency'] as String,
        status: j['status'] as String,
        lastFailure: j['lastFailure'] as String?,
      );
  final String intentId;
  /// razorpay | mock
  final String provider;
  final String providerOrderId;
  final String? keyId;
  final int amountPaise;
  final String currency;
  /// created | captured | failed
  final String status;
  final String? lastFailure;
  bool get isMock => provider == 'mock';
}

/// Order states (backend OrderState).
enum OrderState {
  awaitingPayment('AWAITING_PAYMENT'),
  paymentFailed('PAYMENT_FAILED'),
  placed('PLACED'),
  accepted('ACCEPTED'),
  preparing('PREPARING'),
  ready('READY'),
  pickedUp('PICKED_UP'),
  outForDelivery('OUT_FOR_DELIVERY'),
  delivered('DELIVERED'),
  cancelled('CANCELLED'),
  rejected('REJECTED'),
  expired('EXPIRED'),
  failedDelivery('FAILED_DELIVERY');

  const OrderState(this.wire);
  final String wire;
  static OrderState parse(String s) => values.firstWhere((v) => v.wire == s);
  bool get isTerminal => const [paymentFailed, delivered, cancelled, rejected, expired].contains(this);
}

class OrderLine {
  const OrderLine({
    required this.name,
    required this.variantLabel,
    required this.quantity,
    required this.linePaise,
    this.status = 'ok',
    this.substituteName,
    this.substituteVariantLabel,
    this.refundPaise = 0,
    this.variantId,
  });
  factory OrderLine.fromJson(Json j) => OrderLine(
        name: j['name'] as String,
        variantLabel: j['variantLabel'] as String,
        quantity: j['quantity'] as int,
        linePaise: j['linePaise'] as int,
        status: j['status'] as String? ?? 'ok',
        substituteName: j['substituteName'] as String?,
        substituteVariantLabel: j['substituteVariantLabel'] as String?,
        refundPaise: j['refundPaise'] as int? ?? 0,
        variantId: j['variantId'] as String?,
      );
  final String name;
  final String variantLabel;
  final int quantity;
  final int linePaise;
  /// ok | removed | substituted (the store changed it while packing, M5).
  final String status;
  final String? substituteName;
  final String? substituteVariantLabel;
  final int refundPaise;
  final String? variantId;
}

class OrderStep {
  const OrderStep(this.state, this.at);
  final OrderState state;
  final DateTime at;
}

class Order {
  const Order({
    required this.id,
    required this.code,
    required this.state,
    required this.merchantId,
    required this.merchantName,
    required this.paymentMethod,
    required this.lines,
    required this.bill,
    required this.totalPaise,
    required this.createdAt,
    required this.history,
    required this.addressLine,
    this.merchantNameTe,
    this.slotStartsAt,
    this.slotEnd,
    this.instructions,
    this.placedAt,
    this.paymentDueAt,
    this.payment,
    this.refundedPaise = 0,
    this.outcomeReason,
    this.canCancel = false,
    this.merchantType = 'retail',
  });
  factory Order.fromJson(Json j) {
    final m = j['merchant'] as Json;
    final when = j['when'] as Json;
    return Order(
      id: j['id'] as String,
      code: j['code'] as String,
      state: OrderState.parse(j['state'] as String),
      merchantId: m['id'] as String,
      merchantName: m['name'] as String,
      merchantNameTe: m['nameTe'] as String?,
      paymentMethod: j['paymentMethod'] == 'cod' ? PaymentMethodChoice.cod : PaymentMethodChoice.online,
      lines: _list(j['lines'], OrderLine.fromJson),
      bill: Bill.fromJson(j['bill'] as Json),
      totalPaise: j['totalPaise'] as int,
      createdAt: DateTime.parse(j['createdAt'] as String),
      placedAt: _date(j['placedAt']),
      paymentDueAt: _date(j['paymentDueAt']),
      slotStartsAt: _date(when['startsAt']),
      slotEnd: when['end'] as String?,
      instructions: j['instructions'] as String?,
      addressLine: (j['address'] as Json)['line'] as String,
      history: _list(j['history'], (h) => OrderStep(OrderState.parse(h['to'] as String), DateTime.parse(h['at'] as String))),
      payment: j['payment'] == null ? null : PaymentCheckout.fromJson(j['payment'] as Json),
      refundedPaise: j['refundedPaise'] as int? ?? 0,
      outcomeReason: j['outcomeReason'] as String?,
      canCancel: j['canCancel'] as bool? ?? false,
      merchantType: m['type'] as String? ?? 'retail',
    );
  }
  final String id;
  final String code;
  final OrderState state;
  final String merchantId;
  final String merchantName;
  final String? merchantNameTe;
  final PaymentMethodChoice paymentMethod;
  final List<OrderLine> lines;
  final Bill bill;
  final int totalPaise;
  final DateTime createdAt;
  final DateTime? placedAt;
  final DateTime? paymentDueAt;
  final DateTime? slotStartsAt;
  final String? slotEnd;
  final String? instructions;
  final String addressLine;
  final List<OrderStep> history;
  final PaymentCheckout? payment;
  /// Refunded to the wallet so far (M5).
  final int refundedPaise;
  final String? outcomeReason;
  /// True until the store accepts.
  final bool canCancel;
  /// retail | fashion | home_business | home_kitchen (issue types and windows depend on it).
  final String merchantType;
  int get itemCount => lines.fold(0, (n, l) => n + l.quantity);
}

class WalletEntry {
  const WalletEntry({required this.amountPaise, required this.kind, required this.createdAt, this.note, this.orderId});
  factory WalletEntry.fromJson(Json j) => WalletEntry(
        amountPaise: j['amountPaise'] as int,
        kind: j['kind'] as String,
        note: j['note'] as String?,
        orderId: j['orderId'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final int amountPaise;
  final String kind;
  final String? note;
  final String? orderId;
  final DateTime createdAt;
}

class Wallet {
  const Wallet(this.balancePaise, this.entries);
  factory Wallet.fromJson(Json j) => Wallet(j['balancePaise'] as int, _list(j['entries'], WalletEntry.fromJson));
  final int balancePaise;
  final List<WalletEntry> entries;
}

/// The customer's rating of a delivered order (GET/POST /v1/orders/{id}/rating).
class OrderRating {
  const OrderRating({required this.orderId, required this.storeStars, required this.createdAt, this.riderStars, this.comment});
  factory OrderRating.fromJson(Json j) => OrderRating(
        orderId: j['orderId'] as String,
        storeStars: j['storeStars'] as int,
        riderStars: j['riderStars'] as int?,
        comment: j['comment'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final String orderId;
  final int storeStars;
  final int? riderStars;
  final String? comment;
  final DateTime createdAt;
}
