import 'dart:convert';
import 'dart:io';

import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// Contract: the discovery models parse real API responses (captured from `pnpm dev:fake`) and
/// survive the offline-cache round trip (toJson → fromJson).
void main() {
  test('Feed: kitchens tab, serviceable Dargamitta, scheduled ETA with the next slot', () {
    final f = Feed.fromJson(fixture('feed_kitchens'));
    expect(f.serviceability.serviceable, isTrue);
    expect(f.serviceability.microMarket!.slug, 'dargamitta');
    expect(f.tab, FeedTab.homeKitchens);
    expect(f.tabs.map((t) => t.tab), containsAll(FeedTab.values));
    final k = f.stores.firstWhere((s) => s.name.startsWith('Saraswathi'));
    expect(k.type, MerchantType.homeKitchen);
    expect(k.eta.scheduled, isTrue);
    expect(k.displayName('te'), 'సరస్వతి కిచెన్');
  });

  test('SearchResult: grouped by store, Telugu hints, one-tap ADD data', () {
    final s = SearchResult.fromJson(fixture('search_atta'));
    expect(s.hints.first, 'గోధుమ పిండి');
    final item = s.groups.first.items.first;
    expect(item.variantId, isNotEmpty);
    expect(item.merchantId, s.groups.first.store.id);
    expect(item.mrpPaise == null || item.pricePaise <= item.mrpPaise!, isTrue);
  });

  test('StorePage (kirana): trust row, categories, sizes; round-trips through the cache', () {
    final p = StorePage.fromJson(fixture('store_kirana'));
    expect(p.isKitchen, isFalse);
    expect(p.slots, isNull);
    expect(p.fssaiVerified, isTrue);
    expect(p.categories.fold<int>(0, (n, c) => n + c.count), p.items.length);
    final atta = p.items.firstWhere((i) => i.card.name == 'Annapoorna Chakki Atta');
    expect(atta.variants.map((v) => v.label), ['1 kg', '5 kg', '10 kg']);
    final again = StorePage.fromJson(jsonDecode(jsonEncode(p.toJson())) as Map<String, dynamic>);
    expect(again.items.length, p.items.length);
    expect(again.store.eta.maxMin, p.store.eta.maxMin);
    expect(again.photos, p.photos);
  });

  test('StorePage (home kitchen): slots with cut-offs, menu flags, allergens', () {
    final p = StorePage.fromJson(fixture('store_kitchen'));
    expect(p.isKitchen, isTrue);
    expect(p.hygieneDeclared, isTrue);
    expect(p.slots, isNotEmpty);
    for (final o in p.slots!) {
      expect(o.cutoffAt.isBefore(o.startsAt), isTrue);
    }
    final pulusu = p.items.firstWhere((i) => i.card.name.startsWith('Nellore Chepala Pulusu'));
    expect(pulusu.card.foodMark, FoodMark.nonVeg);
    expect(pulusu.allergens, ['fish', 'mustard']);
    expect(pulusu.dailyCapacity, 15);
    final again = StorePage.fromJson(jsonDecode(jsonEncode(p.toJson())) as Map<String, dynamic>);
    expect(again.slots!.length, p.slots!.length);
  });

  test('Address + AddressInput', () {
    final a = Address.fromJson({
      'id': '1',
      'label': 'work',
      'name': null,
      'line': 'Magunta Towers',
      'landmark': null,
      'pincode': '524003',
      'location': {'lat': 14.44, 'lng': 79.98},
      'isDefault': false,
      'serviceable': true,
      'microMarket': {'id': 'm', 'slug': 'magunta-layout', 'name': 'Magunta Layout', 'nameTe': 'మాగుంట లేఅవుట్'},
    });
    expect(a.label, AddressLabel.work);
    expect(a.microMarket!.slug, 'magunta-layout');
    final body = const AddressInput(label: AddressLabel.home, line: '4-12, Dargamitta', location: LatLng(14.45, 79.99), landmark: '').toJson();
    expect(body.containsKey('landmark'), isFalse);
    expect(body['location'], {'lat': 14.45, 'lng': 79.99});
  });

  test('Address list (seeded consumer): default first, with micro-markets', () {
    final items = (fixture('address_list')['items'] as List).map((a) => Address.fromJson(a as Map<String, dynamic>)).toList();
    expect(items.first.isDefault, isTrue);
    expect(items.first.microMarket!.slug, 'dargamitta');
    expect(items[1].label, AddressLabel.work);
  });

  test('Feed (stores tab) parses ASAP ETAs', () {
    final f = Feed.fromJson(fixture('feed_stores'));
    expect(f.stores.first.eta.scheduled, isFalse);
    expect(f.stores.first.eta.minMin, greaterThan(0));
  });
}
