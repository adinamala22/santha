import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:test/test.dart';
import 'package:santha_api/santha_api.dart';

Map<String, dynamic> fixture(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync())
        as Map<String, dynamic>;

/// Contract: the hand-written models parse real API responses (captured from `pnpm dev:fake`).
void main() {
  test(
    'ItemPage: a home-kitchen item with portion variant, allergens and capacity',
    () {
      final page = ItemPage.fromJson(fixture('item_page_kitchen'));
      final i = page.items.first;
      expect(i.name, startsWith('Nellore Chepala Pulusu'));
      expect(i.foodMark, FoodMark.nonVeg);
      expect(i.allergens, containsAll(['fish', 'mustard']));
      expect(i.dailyCapacity, 15);
      expect(i.status, ItemStatus.active);
      expect(i.variants.single.unit, ItemUnit.portion);
      expect(i.variants.single.pricePaise, 32000);
      expect(i.stock, StockState.low); // the demo seed marks a few sizes low
      expect(i.minPricePaise, 32000);
    },
  );

  test('SlotList: kitchen slots and the next open occurrence', () {
    final s = SlotList.fromJson(fixture('slot_list'));
    expect(s.slots.map((x) => x.label), ['Lunch', 'Late lunch', 'Dinner']);
    expect(s.slots.first.toJson(), containsPair('cutoffMin', 90));
    expect(s.nextOpen?.state, 'open');
  });

  test(
    'BarcodeResult: master product with MRP and pack; already sold here',
    () {
      final r = BarcodeResult.fromJson(fixture('barcode_result'));
      expect(r.fromOpenSource, isFalse);
      expect(r.product.displayName, 'Annapoorna Chakki Atta 1 kg');
      expect(r.product.mrpPaise, 6200);
      expect(r.product.unit, ItemUnit.kg);
    },
  );

  test('MerchantView carries store photos and the photos checklist step', () {
    final v = MerchantView.fromJson(fixture('merchant_view_with_photos'));
    expect(v.photos.single.status, MediaStatus.approved);
    expect(v.photos.single.thumbUrl, endsWith('thumb.webp'));
    expect(v.checklist.map((c) => c.key), contains(ChecklistKey.photos));
  });

  test('Variant.toJson round-trips stock wire values', () {
    const v = Variant(
      label: '500 g',
      unit: ItemUnit.g,
      unitQty: 500,
      pricePaise: 5000,
      mrpPaise: 6000,
      stock: StockState.low,
    );
    expect(v.toJson(), {
      'label': '500 g',
      'unit': 'g',
      'unitQty': 500.0,
      'pricePaise': 5000,
      'mrpPaise': 6000,
      'stock': 'low',
    });
    expect(
      Variant.fromJson({...v.toJson(), 'id': 'x', 'stock': 'in'}).stock,
      StockState.in_,
    );
  });

  test(
    'resolve(): API-relative media/upload URLs use the base URL; absolute ones pass through',
    () {
      final client = SanthaApiClient(
        baseUrl: 'http://10.0.2.2:4000',
        deviceId: 'device-123',
        tokens: MemoryTokenStore(),
        dio: Dio(),
      );
      expect(
        client.resolve('/v1/dev/media/a/thumb.webp'),
        'http://10.0.2.2:4000/v1/dev/media/a/thumb.webp',
      );
      expect(
        client.resolve('https://cdn.santha.app/media/a.webp'),
        'https://cdn.santha.app/media/a.webp',
      );
    },
  );
}
