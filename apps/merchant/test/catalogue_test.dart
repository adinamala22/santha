import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:merchant/features/catalogue/data/catalogue_controller.dart';
import 'package:merchant/features/catalogue/presentation/scan_page.dart';
import 'package:merchant/features/catalogue/presentation/slots_page.dart' show slotDayLabel;
import 'package:merchant/l10n/gen/app_localizations.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

import 'onboarding_test.dart' show FakeMerchantApi, pumpSignedIn;

Map<String, dynamic> _variant(String id, String label, int price, {int? mrp, String stock = 'in', String unit = 'g', num qty = 500}) =>
    {'id': id, 'label': label, 'unit': unit, 'unitQty': qty, 'pricePaise': price, 'mrpPaise': mrp, 'stock': stock};

Map<String, dynamic> _item(String id, String name, {String status = 'active', bool stale = false, String stock = 'in', String category = 'staples', List<Map<String, dynamic>>? variants}) => {
      'id': id, 'merchantId': 'm1', 'masterProductId': null, 'name': name, 'nameTe': null, 'description': null, 'brand': null,
      'categorySlug': category, 'foodMark': 'veg', 'allergens': <String>[], 'madeToOrder': false, 'leadTimeMin': null, 'maxPerOrder': null,
      'availableDays': <String>[], 'dailyCapacity': null, 'specialOn': null, 'status': status, 'reviewReason': null, 'source': 'merchant',
      'images': <Object>[], 'imageUrl': null, 'stock': stock, 'stale': stale, 'confirmedAt': '2026-11-01T00:00:00.000Z',
      'variants': variants ?? [_variant('$id-v', '500 g', 5000, mrp: 6000, stock: stock)],
      'createdAt': '2026-11-01T00:00:00.000Z', 'updatedAt': '2026-11-01T00:00:00.000Z',
    };

/// In-memory catalogue backend with the rules the screens rely on (price ≤ MRP, unknown barcodes).
class FakeCatalogueApi extends CatalogueApi {
  FakeCatalogueApi(super.client, this.rows);
  final List<Map<String, dynamic>> rows;
  final calls = <String>[];
  List<Slot> slotsSaved = [];
  final master = {
    '8901000000019': {
      'id': 'mp1', 'barcode': '8901000000019', 'name': 'Chakki Atta', 'brand': 'Annapoorna', 'mrpPaise': 6200, 'packLabel': '1 kg',
      'unit': 'kg', 'unitQty': 1, 'categorySlug': 'staples', 'imageUrl': null, 'source': 'seed',
    },
  };

  Item _parse(Map<String, dynamic> j) => Item.fromJson(jsonDecode(jsonEncode(j)) as Map<String, dynamic>);

  @override
  Future<List<Category>> categories() async => const [
        Category(slug: 'staples', name: 'Atta, rice & dal', nameTe: 'అట్టా, బియ్యం & పప్పులు'),
        Category(slug: 'dairy', name: 'Milk, curd & paneer', nameTe: 'పాలు, పెరుగు & పనీర్'),
        Category(slug: 'curries', name: 'Curries & pulusu', nameTe: 'కూరలు & పులుసు'),
      ];

  @override
  Future<ItemPage> items({ItemStatus? status, String? q, String? category, bool staleOnly = false, int limit = 200, int offset = 0}) async =>
      ItemPage(rows.map(_parse).toList(), rows.length);

  @override
  Future<Item> item(String id) async => _parse(rows.firstWhere((i) => i['id'] == id));

  @override
  Future<Item> setStock(String id, StockState stock, {String? variantId}) async {
    calls.add('stock $id ${stock.wire}');
    final i = rows.firstWhere((x) => x['id'] == id);
    i['stock'] = stock.wire;
    i['stale'] = false;
    for (final v in (i['variants'] as List).cast<Map<String, dynamic>>()) {
      v['stock'] = stock.wire;
    }
    return _parse(i);
  }

  @override
  Future<Item> create(Map<String, dynamic> body) async {
    calls.add('create ${jsonEncode(body)}');
    final v = (body['variants'] as List).cast<Map<String, dynamic>>();
    final mrp = body['masterProductId'] == 'mp1' ? 6200 : null;
    if (v.any((x) => x['pricePaise'] as int > ((x['mrpPaise'] as int?) ?? mrp ?? 1 << 30))) {
      throw const ApiException(code: 'VALIDATION_FAILED', status: 400, details: {
        'problems': [
          {'field': 'variants.0.pricePaise', 'message': 'Selling price cannot be more than the MRP'},
        ],
      });
    }
    final j = _item('new-${rows.length}', body['name'] as String? ?? 'Annapoorna Chakki Atta 1 kg', category: body['categorySlug'] as String? ?? 'staples');
    rows.insert(0, j);
    return _parse(j);
  }

  @override
  Future<int> confirmAll() async {
    calls.add('confirm');
    for (final i in rows) {
      i['stale'] = false;
    }
    return rows.length;
  }

  @override
  Future<({int approved, int held})> approvePending([List<String>? ids]) async {
    calls.add('approve ${ids ?? 'all'}');
    var n = 0;
    for (final i in rows.where((i) => i['status'] == 'pending_merchant')) {
      i['status'] = 'active';
      n++;
    }
    return (approved: n, held: 0);
  }

  @override
  Future<BarcodeResult> scan(String barcode) async {
    calls.add('scan $barcode');
    final p = master[barcode];
    if (p == null) throw const ApiException(code: 'BARCODE_UNKNOWN', status: 404);
    return BarcodeResult.fromJson({'source': 'master', 'product': p, 'existingItemId': null});
  }

  @override
  Future<ImportReport> importCsv(String csv, {required bool dryRun}) async {
    calls.add('import dryRun=$dryRun');
    return ImportReport.fromJson({
      'dryRun': dryRun,
      'rows': 3,
      'created': dryRun ? 0 : 2,
      'held': 0,
      'items': [
        {'lines': [2], 'name': 'Loose Rice', 'itemId': null},
        {'lines': [3], 'name': 'Wheat Rava', 'itemId': null},
      ],
      'rejected': [
        {'line': 4, 'reasons': ['price is not a valid amount']},
      ],
    });
  }

  @override
  Future<SlotList> slots() async => SlotList(slotsSaved, null);

  @override
  Future<SlotList> saveSlots(List<Slot> slots) async {
    calls.add('slots ${slots.length}');
    slotsSaved = slots;
    return SlotList(slots, null);
  }

  @override
  Future<Media> uploadPhoto(Uint8List bytes, {required String contentType, required bool store}) async {
    calls.add('upload store=$store $contentType');
    return const Media(id: 'media-1', status: MediaStatus.pendingReview, thumbUrl: '/v1/dev/media/x/thumb.webp');
  }

  @override
  Future<MerchantView> setStorePhotos(List<String> mediaIds) async {
    calls.add('photos ${mediaIds.join(',')}');
    final v = FakeMerchantApi.build(checklist: [('business', true), ('photos', true)]);
    v['photos'] = [
      for (final id in mediaIds) {'id': id, 'purpose': 'store', 'status': 'pending_review', 'rejectReason': null, 'thumbUrl': null, 'mediumUrl': null, 'createdAt': '2026-11-01T00:00:00.000Z'},
    ];
    return MerchantView.fromJson(v);
  }
}

Future<(ProviderContainer, FakeCatalogueApi)> pumpCatalogue(WidgetTester tester, {List<Map<String, dynamic>>? items, String type = 'retail', String locale = 'en'}) async {
  late FakeCatalogueApi api;
  final (container, _) = await pumpSignedIn(
    tester,
    locale: locale,
    view: FakeMerchantApi.build(type: type, status: 'live', microMarket: {'id': 'mm1', 'slug': 'dargamitta', 'name': 'Dargamitta', 'nameTe': 'దర్గామిట్ట'}),
    overrides: [
      catalogueApiProvider.overrideWith((ref) => api = FakeCatalogueApi(ref.watch(apiClientProvider), items ?? [_item('i1', 'Toor Dal'), _item('i2', 'Moong Dal', stock: 'low')])),
      scannerCameraProvider.overrideWithValue(false), // no camera in widget tests: typed entry
      photoPickerProvider.overrideWithValue(({required bool camera}) async => PickedPhoto(Uint8List.fromList(List.filled(64, 1)), 'image/jpeg')),
    ],
  );
  await tester.tap(find.text(locale == 'te' ? 'మరిన్ని' : 'More'));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('open-catalogue')));
  await tester.pumpAndSettle();
  container.read(catalogueApiProvider);
  return (container, api);
}

void main() {
  test('slot dates read as Today / Tomorrow / weekday (IST)', () {
    final l = lookupAppLocalizations(const Locale('en'));
    final now = DateTime.utc(2026, 11, 2, 20, 0); // 01:30 IST on 3 Nov
    expect(slotDayLabel(l, '2026-11-03', now), 'Today');
    expect(slotDayLabel(l, '2026-11-04', now), 'Tomorrow');
    expect(slotDayLabel(l, '2026-11-06', now), 'Fri');
  });

  testWidgets('a live store opens its catalogue; one tap marks an item out of stock', (tester) async {
    final (container, api) = await pumpCatalogue(tester);
    expect(find.text('Catalogue'), findsOneWidget);
    expect(find.text('Toor Dal'), findsOneWidget);
    expect(find.text('2 items'), findsOneWidget);

    final toggle = find.byKey(const ValueKey('stock-i1'));
    await tester.tap(find.descendant(of: toggle, matching: find.text('Out')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('stock i1 out'));
    await tester.tap(find.byKey(const ValueKey('filter-out')));
    await tester.pumpAndSettle();
    expect(find.text('Toor Dal'), findsOneWidget);
    expect(find.text('Moong Dal'), findsNothing);
    final events = (container.read(analyticsProvider) as DebugAnalytics).events.map((e) => e.$1);
    expect(events, contains('catalogue_stock_changed'));
  });

  testWidgets('items Santha built wait for approval; approve all puts them live', (tester) async {
    final (_, api) = await pumpCatalogue(tester, items: [_item('p1', 'Kanchi Pattu Saree', status: 'pending_merchant', category: 'sarees'), _item('i1', 'Toor Dal')]);
    expect(find.text('Catalogue pending your approval'), findsOneWidget);
    expect(find.text('Santha added 1 item for you. Check them and approve.'), findsOneWidget);
    expect(find.text('Kanchi Pattu Saree'), findsNothing); // shown in the banner, not the list
    await tester.tap(find.text('Approve all'));
    await tester.pumpAndSettle();
    expect(api.calls, contains('approve all'));
    expect(find.byKey(const ValueKey('pending-banner')), findsNothing);
    expect(find.text('Kanchi Pattu Saree'), findsOneWidget);
  });

  testWidgets('stale items prompt the daily check; confirming clears it', (tester) async {
    final (_, api) = await pumpCatalogue(tester, items: [_item('i1', 'Toor Dal', stale: true), _item('i2', 'Moong Dal', stale: true)]);
    expect(find.text('Is your stock still right?'), findsOneWidget);
    expect(find.textContaining('2 items have not been checked'), findsOneWidget);
    await tester.tap(find.text('Everything is as listed'));
    await tester.pumpAndSettle();
    expect(api.calls, contains('confirm'));
    expect(find.byKey(const ValueKey('stale-banner')), findsNothing);
  });

  testWidgets('scan → master product pre-fills the form; price above MRP is refused; a valid price saves', (tester) async {
    final (_, api) = await pumpCatalogue(tester);
    await tester.tap(find.byKey(const ValueKey('cat-scan')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('scan-manual')), '8901000000019');
    await tester.tap(find.byKey(const ValueKey('scan-find')));
    await tester.pumpAndSettle();

    expect(api.calls, contains('scan 8901000000019'));
    expect(find.text('From the Santha catalogue · MRP ₹62'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Annapoorna Chakki Atta 1 kg'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('variant-0-price')), '70');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('item-save')), 300, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.byKey(const ValueKey('item-save')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('item-save')));
    await tester.pumpAndSettle();
    expect(find.text('The price cannot be more than the MRP.'), findsWidgets);
    expect(api.calls.where((c) => c.startsWith('create')), isEmpty);

    await tester.scrollUntilVisible(find.byKey(const ValueKey('variant-0-price')), -300, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.byKey(const ValueKey('variant-0-price')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('variant-0-price')), '58');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('food-veg')), 300, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.byKey(const ValueKey('food-veg')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('food-veg')));
    await tester.scrollUntilVisible(find.byKey(const ValueKey('item-save')), 300, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.byKey(const ValueKey('item-save')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('item-save')));
    await tester.pumpAndSettle();
    final created = api.calls.singleWhere((c) => c.startsWith('create'));
    expect(created, contains('"masterProductId":"mp1"'));
    expect(created, contains('"pricePaise":5800'));
    expect(created, contains('"unit":"kg"'));
  });

  testWidgets('an unknown barcode opens the create-SKU form with an explanation', (tester) async {
    await pumpCatalogue(tester);
    await tester.tap(find.byKey(const ValueKey('cat-scan')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('scan-manual')), '8909999000011');
    await tester.tap(find.byKey(const ValueKey('scan-find')));
    await tester.pumpAndSettle();
    expect(find.text('New item'), findsOneWidget);
    expect(find.textContaining('We do not know this product yet'), findsOneWidget);
  });

  testWidgets('bulk import: check shows ready items and rejected lines, then adds them', (tester) async {
    final (_, api) = await pumpCatalogue(tester);
    await tester.tap(find.byKey(const ValueKey('cat-import')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('import-text')), 'name,category,price\nLoose Rice,staples,58\n');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('import-check')));
    await tester.pumpAndSettle();
    expect(find.text('2 items ready'), findsOneWidget);
    expect(find.text('Line 4: price is not a valid amount'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('import-now')));
    await tester.pumpAndSettle();
    expect(api.calls, containsAllInOrder(['import dryRun=true', 'import dryRun=false']));
    expect(find.text('2 items added'), findsOneWidget);
  });

  testWidgets('a home kitchen adds a lunch slot and saves', (tester) async {
    final (_, api) = await pumpCatalogue(tester, type: 'home_kitchen', items: [_item('k1', 'Veg Meals', category: 'curries')]);
    await tester.tap(find.byKey(const ValueKey('cat-slots')));
    await tester.pumpAndSettle();
    expect(find.text('No slots yet. Add lunch or dinner slots.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('slot-add')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('slot-label')), 'Lunch');
    await tester.tap(find.byKey(const ValueKey('slot-done')));
    await tester.pumpAndSettle();
    expect(find.text('Lunch'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('slots-save')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('slots 1'));
    expect(api.slotsSaved.single.start, '12:30');
  });

  testWidgets('onboarding: a store photo is uploaded from the gallery and completes the step', (tester) async {
    late FakeCatalogueApi api;
    await pumpSignedIn(
      tester,
      view: FakeMerchantApi.build(type: 'retail', checklist: [('business', true), ('location', true), ('hours', true), ('photos', false)]),
      overrides: [
        catalogueApiProvider.overrideWith((ref) => api = FakeCatalogueApi(ref.watch(apiClientProvider), [])),
        photoPickerProvider.overrideWithValue(({required bool camera}) async => PickedPhoto(Uint8List.fromList(List.filled(64, 1)), 'image/jpeg')),
      ],
    );
    await tester.tap(find.byKey(const ValueKey('step-photos')));
    await tester.pumpAndSettle();
    expect(find.text('Store photos'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('photo-gallery')));
    await tester.pumpAndSettle();
    expect(api.calls, ['upload store=true image/jpeg', 'photos media-1']);
    expect(find.text('Waiting for review'), findsOneWidget);
  });

  testWidgets('the catalogue is in Telugu for Telugu users', (tester) async {
    await pumpCatalogue(tester, locale: 'te');
    expect(find.text('క్యాటలాగ్'), findsOneWidget);
    expect(find.text('బార్‌కోడ్ స్కాన్'), findsOneWidget);
    expect(find.text('స్టాక్ ఉంది'), findsWidgets);
  });
}
