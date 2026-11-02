// Catalogue models mirroring apps/backend/openapi.json (ItemDto, MediaDto, BarcodeResultDto,
// SlotListDto, ImportReportDto, CategoryListDto). Hand-written like the onboarding models; a
// contract test parses real API responses (test/fixtures).
import 'merchant_models.dart';
import 'models.dart';

T _wire<T extends Enum>(List<T> values, String value) => values.firstWhere((v) => (v is Wire ? (v as Wire).wire : v.name) == value);

enum StockState { in_, low, out }

extension StockWire on StockState {
  String get wire => this == StockState.in_ ? 'in' : name;
  static StockState parse(String s) => s == 'in' ? StockState.in_ : StockState.values.byName(s);
}

enum FoodMark implements Wire {
  veg('veg'),
  nonVeg('non_veg'),
  egg('egg');

  const FoodMark(this.wire);
  @override
  final String wire;
}

enum ItemUnit { kg, g, l, ml, pc, pack, portion }

enum ItemStatus implements Wire {
  pendingMerchant('pending_merchant'),
  inReview('in_review'),
  active('active'),
  hidden('hidden');

  const ItemStatus(this.wire);
  @override
  final String wire;
}

enum MediaStatus implements Wire {
  uploading('uploading'),
  pendingReview('pending_review'),
  approved('approved'),
  rejected('rejected');

  const MediaStatus(this.wire);
  @override
  final String wire;
}

/// The 14 allergens food labels declare (FSSAI); wire values.
const allergens = [
  'gluten',
  'milk',
  'egg',
  'peanut',
  'tree_nuts',
  'soy',
  'fish',
  'shellfish',
  'sesame',
  'mustard',
  'celery',
  'sulphites',
  'lupin',
  'molluscs',
];

/// An uploaded photo. URLs are absolute, or API-relative (`/v1/dev/media/…`) in fake mode —
/// resolve those with [SanthaApiClient.resolve].
class Media {
  const Media({required this.id, required this.status, this.thumbUrl, this.mediumUrl, this.rejectReason});
  factory Media.fromJson(Json j) => Media(
    id: j['id'] as String,
    status: _wire(MediaStatus.values, j['status'] as String),
    thumbUrl: j['thumbUrl'] as String?,
    mediumUrl: j['mediumUrl'] as String?,
    rejectReason: j['rejectReason'] as String?,
  );
  final String id;
  final MediaStatus status;
  final String? thumbUrl;
  final String? mediumUrl;
  final String? rejectReason;
}

class Variant {
  const Variant({
    this.id,
    required this.label,
    required this.unit,
    required this.unitQty,
    required this.pricePaise,
    this.mrpPaise,
    this.stock = StockState.in_,
  });

  factory Variant.fromJson(Json j) => Variant(
    id: j['id'] as String?,
    label: j['label'] as String,
    unit: ItemUnit.values.byName(j['unit'] as String),
    unitQty: (j['unitQty'] as num).toDouble(),
    pricePaise: j['pricePaise'] as int,
    mrpPaise: j['mrpPaise'] as int?,
    stock: StockWire.parse(j['stock'] as String),
  );

  final String? id;
  final String label;
  final ItemUnit unit;
  final double unitQty;
  final int pricePaise;
  final int? mrpPaise;
  final StockState stock;

  Json toJson() => {
    'id': ?id,
    'label': label,
    'unit': unit.name,
    'unitQty': unitQty,
    'pricePaise': pricePaise,
    'mrpPaise': mrpPaise,
    'stock': stock.wire,
  };
}

class Item {
  const Item({
    required this.id,
    required this.name,
    required this.categorySlug,
    required this.status,
    required this.variants,
    required this.stock,
    required this.stale,
    this.masterProductId,
    this.nameTe,
    this.description,
    this.brand,
    this.foodMark,
    this.allergens = const [],
    this.madeToOrder = false,
    this.leadTimeMin,
    this.maxPerOrder,
    this.availableDays = const [],
    this.dailyCapacity,
    this.specialOn,
    this.reviewReason,
    this.images = const [],
    this.imageUrl,
  });

  factory Item.fromJson(Json j) => Item(
    id: j['id'] as String,
    masterProductId: j['masterProductId'] as String?,
    name: j['name'] as String,
    nameTe: j['nameTe'] as String?,
    description: j['description'] as String?,
    brand: j['brand'] as String?,
    categorySlug: j['categorySlug'] as String,
    foodMark: j['foodMark'] == null ? null : _wire(FoodMark.values, j['foodMark'] as String),
    allergens: (j['allergens'] as List).cast<String>(),
    madeToOrder: j['madeToOrder'] as bool,
    leadTimeMin: j['leadTimeMin'] as int?,
    maxPerOrder: j['maxPerOrder'] as int?,
    availableDays: (j['availableDays'] as List).cast<String>(),
    dailyCapacity: j['dailyCapacity'] as int?,
    specialOn: j['specialOn'] as String?,
    status: _wire(ItemStatus.values, j['status'] as String),
    reviewReason: j['reviewReason'] as String?,
    images: (j['images'] as List).map((m) => Media.fromJson(m as Json)).toList(),
    imageUrl: j['imageUrl'] as String?,
    stock: StockWire.parse(j['stock'] as String),
    stale: j['stale'] as bool,
    variants: (j['variants'] as List).map((v) => Variant.fromJson(v as Json)).toList(),
  );

  final String id;
  final String? masterProductId;
  final String name;
  final String? nameTe;
  final String? description;
  final String? brand;
  final String categorySlug;
  final FoodMark? foodMark;
  final List<String> allergens;
  final bool madeToOrder;
  final int? leadTimeMin;
  final int? maxPerOrder;
  final List<String> availableDays;
  final int? dailyCapacity;
  final String? specialOn;
  final ItemStatus status;
  final String? reviewReason;
  final List<Media> images;
  final String? imageUrl;
  final StockState stock;
  final bool stale;
  final List<Variant> variants;

  int get minPricePaise => variants.map((v) => v.pricePaise).reduce((a, b) => a < b ? a : b);

  /// The same item with new stock (all sizes, or one), for optimistic UI updates.
  Item withStock(StockState s, {String? variantId}) {
    final vs = [
      for (final v in variants)
        variantId == null || v.id == variantId
            ? Variant(id: v.id, label: v.label, unit: v.unit, unitQty: v.unitQty, pricePaise: v.pricePaise, mrpPaise: v.mrpPaise, stock: s)
            : v,
    ];
    final itemStock = vs.any((v) => v.stock == StockState.in_)
        ? StockState.in_
        : vs.any((v) => v.stock == StockState.low)
        ? StockState.low
        : StockState.out;
    return Item(
      id: id,
      masterProductId: masterProductId,
      name: name,
      nameTe: nameTe,
      description: description,
      brand: brand,
      categorySlug: categorySlug,
      foodMark: foodMark,
      allergens: allergens,
      madeToOrder: madeToOrder,
      leadTimeMin: leadTimeMin,
      maxPerOrder: maxPerOrder,
      availableDays: availableDays,
      dailyCapacity: dailyCapacity,
      specialOn: specialOn,
      status: status,
      reviewReason: reviewReason,
      images: images,
      imageUrl: imageUrl,
      stock: itemStock,
      stale: false,
      variants: vs,
    );
  }
}

class ItemPage {
  const ItemPage(this.items, this.total);
  factory ItemPage.fromJson(Json j) => ItemPage((j['items'] as List).map((i) => Item.fromJson(i as Json)).toList(), j['total'] as int);
  final List<Item> items;
  final int total;
}

class MasterProduct {
  const MasterProduct({
    required this.id,
    required this.barcode,
    required this.name,
    required this.categorySlug,
    this.brand,
    this.mrpPaise,
    this.packLabel,
    this.unit,
    this.unitQty,
    this.imageUrl,
  });

  factory MasterProduct.fromJson(Json j) => MasterProduct(
    id: j['id'] as String,
    barcode: j['barcode'] as String,
    name: j['name'] as String,
    brand: j['brand'] as String?,
    mrpPaise: j['mrpPaise'] as int?,
    packLabel: j['packLabel'] as String?,
    unit: j['unit'] == null ? null : ItemUnit.values.byName(j['unit'] as String),
    unitQty: (j['unitQty'] as num?)?.toDouble(),
    categorySlug: j['categorySlug'] as String,
    imageUrl: j['imageUrl'] as String?,
  );

  final String id;
  final String barcode;
  final String name;
  final String? brand;
  final int? mrpPaise;
  final String? packLabel;
  final ItemUnit? unit;
  final double? unitQty;
  final String categorySlug;
  final String? imageUrl;

  String get displayName => [brand, name, packLabel].whereType<String>().join(' ');
}

/// A scan: found in the master catalogue (or the open-barcode source), maybe already sold here.
class BarcodeResult {
  const BarcodeResult({required this.product, required this.fromOpenSource, this.existingItemId});
  factory BarcodeResult.fromJson(Json j) => BarcodeResult(
    product: MasterProduct.fromJson(j['product'] as Json),
    fromOpenSource: j['source'] == 'open_barcode',
    existingItemId: j['existingItemId'] as String?,
  );
  final MasterProduct product;
  final bool fromOpenSource;
  final String? existingItemId;
}

class Category {
  const Category({required this.slug, required this.name, required this.nameTe});
  factory Category.fromJson(Json j) => Category(slug: j['slug'] as String, name: j['name'] as String, nameTe: j['nameTe'] as String);
  final String slug;
  final String name;
  final String nameTe;
}

class ImportReport {
  const ImportReport({
    required this.dryRun,
    required this.rows,
    required this.created,
    required this.held,
    required this.ready,
    required this.rejected,
  });
  factory ImportReport.fromJson(Json j) => ImportReport(
    dryRun: j['dryRun'] as bool,
    rows: j['rows'] as int,
    created: j['created'] as int,
    held: j['held'] as int,
    ready: (j['items'] as List).map((i) => (i as Json)['name'] as String).toList(),
    rejected: (j['rejected'] as List).map((r) => RejectedRow.fromJson(r as Json)).toList(),
  );
  final bool dryRun;
  final int rows;
  final int created;
  final int held;
  final List<String> ready;
  final List<RejectedRow> rejected;
}

class RejectedRow {
  const RejectedRow(this.line, this.reasons);
  factory RejectedRow.fromJson(Json j) => RejectedRow(j['line'] as int, (j['reasons'] as List).cast<String>());
  final int line;
  final List<String> reasons;
}

/// Home-kitchen delivery slot (times are IST, HH:MM).
class Slot {
  const Slot({
    this.id,
    this.label,
    required this.days,
    required this.start,
    required this.end,
    required this.cutoffMin,
    required this.capacity,
  });
  factory Slot.fromJson(Json j) => Slot(
    id: j['id'] as String?,
    label: j['label'] as String?,
    days: (j['days'] as List).cast<String>(),
    start: j['start'] as String,
    end: j['end'] as String,
    cutoffMin: j['cutoffMin'] as int,
    capacity: j['capacity'] as int,
  );
  final String? id;
  final String? label;
  final List<String> days;
  final String start;
  final String end;
  final int cutoffMin;
  final int capacity;

  Json toJson() => {'label': label, 'days': days, 'start': start, 'end': end, 'cutoffMin': cutoffMin, 'capacity': capacity};
}

class SlotOccurrence {
  const SlotOccurrence({
    required this.slotId,
    required this.date,
    required this.start,
    required this.end,
    required this.cutoffAt,
    required this.state,
  });
  factory SlotOccurrence.fromJson(Json j) => SlotOccurrence(
    slotId: j['slotId'] as String,
    date: j['date'] as String,
    start: j['start'] as String,
    end: j['end'] as String,
    cutoffAt: DateTime.parse(j['cutoffAt'] as String),
    state: j['state'] as String,
  );
  final String slotId;
  final String date;
  final String start;
  final String end;
  final DateTime cutoffAt;
  final String state; // open | closed | full
}

class SlotList {
  const SlotList(this.slots, this.nextOpen);
  factory SlotList.fromJson(Json j) => SlotList(
    (j['slots'] as List).map((s) => Slot.fromJson(s as Json)).toList(),
    j['nextOpen'] == null ? null : SlotOccurrence.fromJson(j['nextOpen'] as Json),
  );
  final List<Slot> slots;
  final SlotOccurrence? nextOpen;
}
