// Consumer discovery models mirroring apps/backend/openapi.json (FeedDto, SearchDto, StoreDto,
// AddressDto). Hand-written like the catalogue models; a contract test parses real API responses
// captured from `pnpm dev:fake` (test/fixtures). Every model round-trips through toJson so the
// consumer app can cache pages offline.
import 'catalogue_models.dart';
import 'merchant_models.dart';
import 'models.dart';

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);
List<T> _list<T>(Object? v, T Function(Json) f) => ((v as List?) ?? const []).map((e) => f(e as Json)).toList();
FoodMark? _foodMark(Object? v) => v == null ? null : FoodMark.values.firstWhere((f) => f.wire == v);

/// The four home tabs (supply types).
enum FeedTab implements Wire {
  stores('stores'),
  fashion('fashion'),
  homeKitchens('home_kitchens'),
  homeBusinesses('home_businesses');

  const FeedTab(this.wire);
  @override
  final String wire;
  static FeedTab parse(String s) => values.firstWhere((t) => t.wire == s);
}

class Serviceability {
  const Serviceability({required this.serviceable, this.microMarket});
  factory Serviceability.fromJson(Json j) =>
      Serviceability(serviceable: j['serviceable'] as bool, microMarket: j['microMarket'] == null ? null : MicroMarketRef.fromJson(j['microMarket'] as Json));
  final bool serviceable;
  final MicroMarketRef? microMarket;
  Json toJson() => {'serviceable': serviceable, 'microMarket': microMarket == null ? null : _mm(microMarket!)};
}

Json _mm(MicroMarketRef m) => {'id': m.id, 'slug': m.slug, 'name': m.name, 'nameTe': m.nameTe};

class NextSlot {
  const NextSlot({required this.date, required this.start, required this.end, required this.cutoffAt});
  factory NextSlot.fromJson(Json j) => NextSlot(date: j['date'] as String, start: j['start'] as String, end: j['end'] as String, cutoffAt: DateTime.parse(j['cutoffAt'] as String));
  final String date; // YYYY-MM-DD (IST)
  final String start; // HH:MM
  final String end;
  final DateTime cutoffAt;
  Json toJson() => {'date': date, 'start': start, 'end': end, 'cutoffAt': cutoffAt.toIso8601String()};
}

/// ETA chip data: an ASAP range, or the next slot for scheduled (home-kitchen) stores.
class Eta {
  const Eta.asap(this.minMin, this.maxMin) : scheduled = false, nextSlot = null;
  const Eta.scheduled(this.nextSlot) : scheduled = true, minMin = 0, maxMin = 0;
  factory Eta.fromJson(Json j) => j['mode'] == 'asap'
      ? Eta.asap(j['minMin'] as int, j['maxMin'] as int)
      : Eta.scheduled(j['nextSlot'] == null ? null : NextSlot.fromJson(j['nextSlot'] as Json));
  final bool scheduled;
  final int minMin;
  final int maxMin;
  final NextSlot? nextSlot;
  Json toJson() => scheduled ? {'mode': 'scheduled', 'nextSlot': nextSlot?.toJson()} : {'mode': 'asap', 'minMin': minMin, 'maxMin': maxMin};
}

class StoreSummary {
  const StoreSummary({
    required this.id,
    required this.name,
    required this.type,
    required this.distanceM,
    required this.eta,
    required this.open,
    required this.selfDelivers,
    required this.hygieneDeclared,
    required this.ratingCount,
    required this.movPaise,
    required this.itemCount,
    this.nameTe,
    this.category,
    this.photoUrl,
    this.nextOpenAt,
    this.closesAt,
    this.rating,
  });

  factory StoreSummary.fromJson(Json j) => StoreSummary(
        id: j['id'] as String,
        name: j['name'] as String,
        nameTe: j['nameTe'] as String?,
        type: MerchantType.values.firstWhere((t) => t.wire == j['type']),
        category: j['category'] as String?,
        photoUrl: j['photoUrl'] as String?,
        distanceM: j['distanceM'] as int,
        eta: Eta.fromJson(j['eta'] as Json),
        open: j['open'] as bool,
        nextOpenAt: _date(j['nextOpenAt']),
        closesAt: _date(j['closesAt']),
        selfDelivers: j['selfDelivers'] as bool,
        hygieneDeclared: j['hygieneDeclared'] as bool,
        rating: (j['rating'] as num?)?.toDouble(),
        ratingCount: j['ratingCount'] as int,
        movPaise: j['movPaise'] as int,
        itemCount: j['itemCount'] as int,
      );

  final String id;
  final String name;
  final String? nameTe;
  final MerchantType type;
  final String? category;
  final String? photoUrl;
  final int distanceM;
  final Eta eta;
  final bool open;
  final DateTime? nextOpenAt;
  final DateTime? closesAt;
  final bool selfDelivers;
  final bool hygieneDeclared;
  final double? rating;
  final int ratingCount;
  final int movPaise;
  final int itemCount;

  String displayName(String lang) => lang == 'te' && nameTe != null ? nameTe! : name;

  Json toJson() => {
        'id': id,
        'name': name,
        'nameTe': nameTe,
        'type': type.wire,
        'category': category,
        'photoUrl': photoUrl,
        'distanceM': distanceM,
        'eta': eta.toJson(),
        'open': open,
        'nextOpenAt': nextOpenAt?.toIso8601String(),
        'closesAt': closesAt?.toIso8601String(),
        'selfDelivers': selfDelivers,
        'hygieneDeclared': hygieneDeclared,
        'rating': rating,
        'ratingCount': ratingCount,
        'movPaise': movPaise,
        'itemCount': itemCount,
      };
}

/// An item as shown in search results and grids; carries the default size for one-tap ADD.
class ItemCard {
  const ItemCard({
    required this.id,
    required this.merchantId,
    required this.variantId,
    required this.variantLabel,
    required this.name,
    required this.categorySlug,
    required this.pricePaise,
    required this.variantCount,
    required this.stale,
    required this.madeToOrder,
    this.nameTe,
    this.brand,
    this.mrpPaise,
    this.foodMark,
    this.imageUrl,
  });

  factory ItemCard.fromJson(Json j) => ItemCard(
        id: j['id'] as String,
        merchantId: j['merchantId'] as String,
        variantId: j['variantId'] as String,
        variantLabel: j['variantLabel'] as String,
        name: j['name'] as String,
        nameTe: j['nameTe'] as String?,
        brand: j['brand'] as String?,
        categorySlug: j['categorySlug'] as String,
        pricePaise: j['pricePaise'] as int,
        mrpPaise: j['mrpPaise'] as int?,
        foodMark: _foodMark(j['foodMark']),
        imageUrl: j['imageUrl'] as String?,
        variantCount: j['variantCount'] as int,
        stale: j['stale'] as bool,
        madeToOrder: j['madeToOrder'] as bool,
      );

  final String id;
  final String merchantId;
  final String variantId;
  final String variantLabel;
  final String name;
  final String? nameTe;
  final String? brand;
  final String categorySlug;
  final int pricePaise;
  final int? mrpPaise;
  final FoodMark? foodMark;
  final String? imageUrl;
  final int variantCount;
  final bool stale;
  final bool madeToOrder;

  String displayName(String lang) => lang == 'te' && nameTe != null ? nameTe! : name;

  Json toJson() => {
        'id': id,
        'merchantId': merchantId,
        'variantId': variantId,
        'variantLabel': variantLabel,
        'name': name,
        'nameTe': nameTe,
        'brand': brand,
        'categorySlug': categorySlug,
        'pricePaise': pricePaise,
        'mrpPaise': mrpPaise,
        'foodMark': foodMark?.wire,
        'imageUrl': imageUrl,
        'variantCount': variantCount,
        'stale': stale,
        'madeToOrder': madeToOrder,
      };
}

class FeedTabCount {
  const FeedTabCount(this.tab, this.count);
  final FeedTab tab;
  final int count;
}

class Feed {
  const Feed({required this.serviceability, required this.tab, required this.tabs, required this.stores});
  factory Feed.fromJson(Json j) => Feed(
        serviceability: Serviceability.fromJson(j['serviceability'] as Json),
        tab: FeedTab.parse(j['tab'] as String),
        tabs: _list(j['tabs'], (t) => FeedTabCount(FeedTab.parse(t['key'] as String), t['count'] as int)),
        stores: _list(j['stores'], StoreSummary.fromJson),
      );
  final Serviceability serviceability;
  final FeedTab tab;
  final List<FeedTabCount> tabs;
  final List<StoreSummary> stores;
}

class SearchGroup {
  const SearchGroup({required this.store, required this.items, required this.more});
  final StoreSummary store;
  final List<ItemCard> items;

  /// Further matches in this store beyond [items].
  final int more;
}

class SearchResult {
  const SearchResult({
    required this.serviceability,
    required this.query,
    required this.hints,
    required this.groups,
    required this.stores,
    required this.totalItems,
    required this.zeroResult,
  });
  factory SearchResult.fromJson(Json j) => SearchResult(
        serviceability: Serviceability.fromJson(j['serviceability'] as Json),
        query: j['query'] as String,
        hints: ((j['hints'] as List?) ?? const []).cast<String>(),
        groups: _list(
          j['groups'],
          (g) => SearchGroup(store: StoreSummary.fromJson(g['store'] as Json), items: _list(g['items'], ItemCard.fromJson), more: g['more'] as int),
        ),
        stores: _list(j['stores'], StoreSummary.fromJson),
        totalItems: j['totalItems'] as int,
        zeroResult: j['zeroResult'] as bool,
      );
  final Serviceability serviceability;
  final String query;

  /// "Did you mean": Telugu script and transliterated forms of the query.
  final List<String> hints;
  final List<SearchGroup> groups;
  final List<StoreSummary> stores;
  final int totalItems;
  final bool zeroResult;
}

class StoreVariant {
  const StoreVariant({required this.id, required this.label, required this.pricePaise, required this.stock, this.mrpPaise});
  factory StoreVariant.fromJson(Json j) => StoreVariant(
        id: j['id'] as String,
        label: j['label'] as String,
        pricePaise: j['pricePaise'] as int,
        mrpPaise: j['mrpPaise'] as int?,
        stock: StockWire.parse(j['stock'] as String),
      );
  final String id;
  final String label;
  final int pricePaise;
  final int? mrpPaise;
  final StockState stock;
  Json toJson() => {'id': id, 'label': label, 'pricePaise': pricePaise, 'mrpPaise': mrpPaise, 'stock': stock.wire};
}

/// An item on a store page: the card plus what the product sheet shows.
class StoreItem {
  const StoreItem({
    required this.card,
    required this.allergens,
    required this.stock,
    required this.variants,
    required this.onMenuToday,
    required this.special,
    this.description,
    this.leadTimeMin,
    this.maxPerOrder,
    this.dailyCapacity,
  });

  factory StoreItem.fromJson(Json j) => StoreItem(
        card: ItemCard.fromJson(j),
        description: j['description'] as String?,
        allergens: ((j['allergens'] as List?) ?? const []).cast<String>(),
        leadTimeMin: j['leadTimeMin'] as int?,
        maxPerOrder: j['maxPerOrder'] as int?,
        stock: StockWire.parse(j['stock'] as String),
        variants: _list(j['variants'], StoreVariant.fromJson),
        onMenuToday: j['onMenuToday'] as bool,
        dailyCapacity: j['dailyCapacity'] as int?,
        special: j['special'] as bool,
      );

  final ItemCard card;
  final String? description;
  final List<String> allergens;
  final int? leadTimeMin;
  final int? maxPerOrder;
  final StockState stock;
  final List<StoreVariant> variants;
  final bool onMenuToday;
  final int? dailyCapacity;
  final bool special;

  String get id => card.id;

  Json toJson() => {
        ...card.toJson(),
        'description': description,
        'allergens': allergens,
        'leadTimeMin': leadTimeMin,
        'maxPerOrder': maxPerOrder,
        'stock': stock.wire,
        'variants': variants.map((v) => v.toJson()).toList(),
        'onMenuToday': onMenuToday,
        'dailyCapacity': dailyCapacity,
        'special': special,
      };
}

class StoreCategory {
  const StoreCategory({required this.slug, required this.name, required this.nameTe, required this.count});
  factory StoreCategory.fromJson(Json j) => StoreCategory(slug: j['slug'] as String, name: j['name'] as String, nameTe: j['nameTe'] as String, count: j['count'] as int);
  final String slug;
  final String name;
  final String nameTe;
  final int count;
  String displayName(String lang) => lang == 'te' ? nameTe : name;
  Json toJson() => {'slug': slug, 'name': name, 'nameTe': nameTe, 'count': count};
}

class SlotOpening {
  const SlotOpening({
    required this.slotId,
    required this.date,
    required this.start,
    required this.end,
    required this.startsAt,
    required this.cutoffAt,
    required this.capacity,
    required this.booked,
    required this.state,
  });
  factory SlotOpening.fromJson(Json j) => SlotOpening(
        slotId: j['slotId'] as String,
        date: j['date'] as String,
        start: j['start'] as String,
        end: j['end'] as String,
        startsAt: DateTime.parse(j['startsAt'] as String),
        cutoffAt: DateTime.parse(j['cutoffAt'] as String),
        capacity: j['capacity'] as int,
        booked: j['booked'] as int,
        state: j['state'] as String,
      );
  final String slotId;
  final String date;
  final String start;
  final String end;
  final DateTime startsAt;
  final DateTime cutoffAt;
  final int capacity;
  final int booked;
  final String state; // open | closed | full
  bool get isOpen => state == 'open';
  Json toJson() => {
        'slotId': slotId,
        'date': date,
        'start': start,
        'end': end,
        'startsAt': startsAt.toIso8601String(),
        'cutoffAt': cutoffAt.toIso8601String(),
        'capacity': capacity,
        'booked': booked,
        'state': state,
      };
}

/// Store / home-kitchen page.
class StorePage {
  const StorePage({
    required this.store,
    required this.deliversHere,
    required this.photos,
    required this.fssaiVerified,
    required this.hygieneDeclared,
    required this.freeDeliveryAbovePaise,
    required this.categories,
    required this.items,
    required this.generatedAt,
    this.description,
    this.microMarket,
    this.returnPolicy,
    this.slots,
  });

  factory StorePage.fromJson(Json j) => StorePage(
        store: StoreSummary.fromJson(j['store'] as Json),
        description: j['description'] as String?,
        microMarket: j['microMarket'] == null ? null : MicroMarketRef.fromJson(j['microMarket'] as Json),
        deliversHere: j['deliversHere'] as bool,
        photos: _list(j['photos'], (p) => (p['mediumUrl'] ?? p['thumbUrl']) as String?).whereType<String>().toList(),
        fssaiVerified: j['fssaiVerified'] as bool,
        hygieneDeclared: j['hygieneDeclared'] as bool,
        returnPolicy: j['returnPolicy'] as String?,
        freeDeliveryAbovePaise: j['freeDeliveryAbovePaise'] as int,
        categories: _list(j['categories'], StoreCategory.fromJson),
        items: _list(j['items'], StoreItem.fromJson),
        slots: j['slots'] == null ? null : _list((j['slots'] as Json)['occurrences'], SlotOpening.fromJson),
        generatedAt: DateTime.parse(j['generatedAt'] as String),
      );

  final StoreSummary store;
  final String? description;
  final MicroMarketRef? microMarket;
  final bool deliversHere;

  /// Medium-size photo URLs.
  final List<String> photos;
  final bool fssaiVerified;
  final bool hygieneDeclared;
  final String? returnPolicy;
  final int freeDeliveryAbovePaise;
  final List<StoreCategory> categories;
  final List<StoreItem> items;

  /// Home kitchens: upcoming slot occurrences (null for ASAP stores).
  final List<SlotOpening>? slots;
  final DateTime generatedAt;

  bool get isKitchen => store.type == MerchantType.homeKitchen;

  Json toJson() => {
        'store': store.toJson(),
        'description': description,
        'microMarket': microMarket == null ? null : _mm(microMarket!),
        'deliversHere': deliversHere,
        'photos': photos.map((u) => {'thumbUrl': null, 'mediumUrl': u}).toList(),
        'fssaiVerified': fssaiVerified,
        'hygieneDeclared': hygieneDeclared,
        'returnPolicy': returnPolicy,
        'freeDeliveryAbovePaise': freeDeliveryAbovePaise,
        'categories': categories.map((c) => c.toJson()).toList(),
        'items': items.map((i) => i.toJson()).toList(),
        'slots': slots == null ? null : {'occurrences': slots!.map((s) => s.toJson()).toList(), 'nextOpen': null},
        'generatedAt': generatedAt.toIso8601String(),
      };
}

enum AddressLabel { home, work, other }

class Address {
  const Address({
    required this.id,
    required this.label,
    required this.line,
    required this.location,
    required this.isDefault,
    required this.serviceable,
    this.name,
    this.landmark,
    this.pincode,
    this.microMarket,
  });

  factory Address.fromJson(Json j) => Address(
        id: j['id'] as String,
        label: AddressLabel.values.byName(j['label'] as String),
        name: j['name'] as String?,
        line: j['line'] as String,
        landmark: j['landmark'] as String?,
        pincode: j['pincode'] as String?,
        location: LatLng.fromJson(j['location'] as Json),
        isDefault: j['isDefault'] as bool,
        serviceable: j['serviceable'] as bool,
        microMarket: j['microMarket'] == null ? null : MicroMarketRef.fromJson(j['microMarket'] as Json),
      );

  final String id;
  final AddressLabel label;
  final String? name;
  final String line;
  final String? landmark;
  final String? pincode;
  final LatLng location;
  final bool isDefault;
  final bool serviceable;
  final MicroMarketRef? microMarket;
}

/// Body for creating / editing an address.
class AddressInput {
  const AddressInput({required this.label, required this.line, required this.location, this.name, this.landmark, this.pincode, this.isDefault});
  final AddressLabel label;
  final String line;
  final LatLng location;
  final String? name;
  final String? landmark;
  final String? pincode;
  final bool? isDefault;
  Json toJson() => {
        'label': label.name,
        'line': line,
        'location': location.toJson(),
        if (name != null && name!.isNotEmpty) 'name': name,
        if (landmark != null && landmark!.isNotEmpty) 'landmark': landmark,
        if (pincode != null && pincode!.isNotEmpty) 'pincode': pincode,
        'isDefault': ?isDefault,
      };
}
