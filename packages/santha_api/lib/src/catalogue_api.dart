import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'catalogue_models.dart';
import 'merchant_models.dart';
import 'models.dart';

/// Catalogue for the merchant app: items, stock, barcode scans, bulk import, menus/slots and
/// photos (`/v1/merchants/me/*`, `/v1/catalogue/*`). Errors are [ApiException]s; a scan of an
/// unknown product throws code `BARCODE_UNKNOWN` (→ create-SKU form).
class CatalogueApi {
  CatalogueApi(this.client, {Dio? uploader}) : _uploader = uploader ?? Dio();

  final SanthaApiClient client;
  final Dio _uploader;
  Dio get _dio => client.dio;

  Future<List<Category>> categories() => _call(() async {
        final r = await _dio.get<Json>('/v1/merchants/me/categories');
        return (r.data!['items'] as List).map((c) => Category.fromJson(c as Json)).toList();
      });

  Future<ItemPage> items({ItemStatus? status, String? q, String? category, bool staleOnly = false, int limit = 200, int offset = 0}) => _call(() async {
        final r = await _dio.get<Json>('/v1/merchants/me/items', queryParameters: {
          'status': ?status?.wire,
          if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
          'category': ?category,
          if (staleOnly) 'stale': 'true',
          'limit': limit,
          'offset': offset,
        });
        return ItemPage.fromJson(r.data!);
      });

  Future<Item> item(String id) => _item(() => _dio.get<Json>('/v1/merchants/me/items/$id'));

  /// [body] follows CreateItemDto (masterProductId pre-fills name, brand, category and MRP).
  Future<Item> create(Json body) => _item(() => _dio.post<Json>('/v1/merchants/me/items', data: body));

  Future<Item> update(String id, Json patch) => _item(() => _dio.patch<Json>('/v1/merchants/me/items/$id', data: patch));

  /// Whole item ([variantId] null) or one size.
  Future<Item> setStock(String id, StockState stock, {String? variantId}) =>
      _item(() => _dio.put<Json>('/v1/merchants/me/items/$id/stock', data: {'stock': stock.wire, 'variantId': ?variantId}));

  Future<void> delete(String id) => _call(() => _dio.delete<void>('/v1/merchants/me/items/$id'));

  /// Daily check: everything is as listed (clears stale flags). Returns how many items were confirmed.
  Future<int> confirmAll() => _call(() async => (await _dio.post<Json>('/v1/merchants/me/items/confirm')).data!['confirmed'] as int);

  Future<ImportReport> importCsv(String csv, {required bool dryRun}) => _call(() async {
        final r = await _dio.post<Json>('/v1/merchants/me/items/import', data: {'csv': csv, 'dryRun': dryRun});
        return ImportReport.fromJson(r.data!);
      });

  /// Approve items Santha built for you: ids, or every pending item when [ids] is null.
  Future<({int approved, int held})> approvePending([List<String>? ids]) => _call(() async {
        final r = await _dio.post<Json>('/v1/merchants/me/items/approve', data: {'ids': ids ?? 'all'});
        return (approved: r.data!['approved'] as int, held: r.data!['held'] as int);
      });

  Future<BarcodeResult> scan(String barcode) => _call(() async {
        final r = await _dio.get<Json>('/v1/catalogue/barcodes/${Uri.encodeComponent(barcode)}');
        return BarcodeResult.fromJson(r.data!);
      });

  Future<List<MasterProduct>> searchMaster(String q) => _call(() async {
        final r = await _dio.get<Json>('/v1/catalogue/master', queryParameters: {'q': q});
        return (r.data!['items'] as List).map((p) => MasterProduct.fromJson(p as Json)).toList();
      });

  Future<SlotList> slots() => _call(() async => SlotList.fromJson((await _dio.get<Json>('/v1/merchants/me/slots')).data!));

  Future<SlotList> saveSlots(List<Slot> slots) => _call(() async {
        final r = await _dio.put<Json>('/v1/merchants/me/slots', data: {'slots': slots.map((s) => s.toJson()).toList()});
        return SlotList.fromJson(r.data!);
      });

  /// Photo pipeline: presigned upload → PUT the bytes → complete (WebP variants, moderation).
  Future<Media> uploadPhoto(Uint8List bytes, {required String contentType, required bool store}) => _call(() async {
        final t = (await _dio.post<Json>('/v1/merchants/me/media', data: {'purpose': store ? 'store' : 'item', 'contentType': contentType})).data!;
        final upload = t['upload'] as Json;
        final media = t['media'] as Json;
        final headers = (upload['headers'] as Map).cast<String, Object>();
        await _uploader.put<void>(
          client.resolve(upload['url'] as String),
          data: Stream.fromIterable([bytes]),
          options: Options(headers: {...headers, Headers.contentLengthHeader: bytes.length}),
        );
        final done = await _dio.post<Json>('/v1/merchants/me/media/${media['id']}/complete');
        return Media.fromJson(done.data!);
      });

  Future<MerchantView> setStorePhotos(List<String> mediaIds) => _call(() async {
        final r = await _dio.put<Json>('/v1/merchants/me/photos', data: {'mediaIds': mediaIds});
        return MerchantView.fromJson(r.data!);
      });

  Future<Item> _item(Future<Response<Json>> Function() req) => _call(() async => Item.fromJson((await req()).data!));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
