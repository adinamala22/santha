import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

final catalogueApiProvider = Provider<CatalogueApi>((ref) => CatalogueApi(ref.watch(apiClientProvider)));

/// Platform categories for this store's type (FR-DIS-3), names in en + te.
final categoriesProvider = FutureProvider<List<Category>>((ref) => ref.watch(catalogueApiProvider).categories());

enum CatalogueFilter { all, out, stale, held, hidden }

class CatalogueState {
  const CatalogueState(this.items);
  final List<Item> items;

  List<Item> get pending => items.where((i) => i.status == ItemStatus.pendingMerchant).toList();
  int get staleCount => items.where((i) => i.stale && i.status == ItemStatus.active).length;

  List<Item> visible(CatalogueFilter f, String query) {
    final q = query.trim().toLowerCase();
    return items.where((i) {
      if (i.status == ItemStatus.pendingMerchant) return false; // shown in the approval banner
      final ok = switch (f) {
        CatalogueFilter.all => true,
        CatalogueFilter.out => i.stock == StockState.out,
        CatalogueFilter.stale => i.stale,
        CatalogueFilter.held => i.status == ItemStatus.inReview,
        CatalogueFilter.hidden => i.status == ItemStatus.hidden,
      };
      if (!ok) return false;
      return q.isEmpty || i.name.toLowerCase().contains(q) || (i.nameTe ?? '').contains(q) || (i.brand ?? '').toLowerCase().contains(q);
    }).toList();
  }

  CatalogueState replace(Item item) => CatalogueState([for (final i in items) i.id == item.id ? item : i]);
  CatalogueState upsert(Item item) => items.any((i) => i.id == item.id) ? replace(item) : CatalogueState([item, ...items]);
  CatalogueState without(String id) => CatalogueState(items.where((i) => i.id != id).toList());
}

/// The store's whole catalogue (≤ 200 items per page is plenty for a neighbourhood shop; the list
/// filters locally so it keeps working on a slow network). Stock toggles update optimistically.
final catalogueProvider = AsyncNotifierProvider<CatalogueController, CatalogueState>(CatalogueController.new);

class CatalogueController extends AsyncNotifier<CatalogueState> {
  CatalogueApi get _api => ref.read(catalogueApiProvider);
  Analytics get _analytics => ref.read(analyticsProvider);

  @override
  Future<CatalogueState> build() async => CatalogueState((await _api.items()).items);

  Future<void> reload() async {
    state = await AsyncValue.guard(() async => CatalogueState((await _api.items()).items));
  }

  /// One-tap stock change; reverts if the server refuses.
  Future<void> setStock(Item item, StockState stock, {String? variantId}) async {
    final before = state.value;
    if (before == null) return;
    state = AsyncData(before.replace(item.withStock(stock, variantId: variantId)));
    try {
      final saved = await _api.setStock(item.id, stock, variantId: variantId);
      _analytics.track('catalogue_stock_changed', {'stock': stock.wire, 'scope': variantId == null ? 'item' : 'size'});
      state = AsyncData(state.value!.replace(saved));
    } catch (_) {
      state = AsyncData(before);
      rethrow;
    }
  }

  Future<int> confirmAll() async {
    final n = await _api.confirmAll();
    _analytics.track('catalogue_confirmed', {'items': n});
    await reload();
    return n;
  }

  Future<int> approvePending() async {
    final r = await _api.approvePending();
    _analytics.track('catalogue_assisted_approved', {'items': r.approved, 'held': r.held});
    await reload();
    return r.approved + r.held;
  }

  /// After the item form saves.
  void saved(Item item) {
    final s = state.value;
    if (s != null) state = AsyncData(s.upsert(item));
  }

  Future<void> delete(String id) async {
    await _api.delete(id);
    final s = state.value;
    if (s != null) state = AsyncData(s.without(id));
  }
}

// ───────── device pickers (behind providers so tests can fake them) ─────────

class PickedPhoto {
  const PickedPhoto(this.bytes, this.contentType);
  final Uint8List bytes;
  final String contentType;
}

typedef PhotoPicker = Future<PickedPhoto?> Function({required bool camera});

final photoPickerProvider = Provider<PhotoPicker>((ref) => ({required bool camera}) async {
      final x = await ImagePicker().pickImage(
        source: camera ? ImageSource.camera : ImageSource.gallery,
        maxWidth: 1800,
        maxHeight: 1800,
        imageQuality: 85,
      );
      if (x == null) return null;
      final bytes = await x.readAsBytes();
      final name = x.name.toLowerCase();
      final type = x.mimeType ?? (name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
      return PickedPhoto(bytes, type);
    });
