import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../onboarding/data/onboarding_controller.dart';
import '../../onboarding/presentation/copy.dart';
import '../../onboarding/presentation/widgets.dart' show requiredField;
import '../data/catalogue_controller.dart';
import 'catalogue_copy.dart';

/// What the form starts from: a scanned master product, an unknown barcode, or nothing.
class ItemFormSeed {
  const ItemFormSeed({this.master, this.unknownBarcode});
  final MasterProduct? master;
  final String? unknownBarcode;
}

/// Loads the item for editing (`/catalogue/item/:id`) or starts a new one (`/catalogue/item/new`).
class ItemFormRoute extends ConsumerWidget {
  const ItemFormRoute({super.key, this.itemId, this.seed});
  final String? itemId;
  final ItemFormSeed? seed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = itemId;
    if (id == null) return ItemFormPage(seed: seed);
    final cached = ref.watch(catalogueProvider).value?.items.where((i) => i.id == id).firstOrNull;
    if (cached != null) return ItemFormPage(item: cached);
    return FutureBuilder<Item>(
      future: ref.read(catalogueApiProvider).item(id),
      builder: (context, snap) => snap.hasData
          ? ItemFormPage(item: snap.data)
          : Scaffold(body: Center(child: snap.hasError ? Text(AppLocalizations.of(context).apiError(snap.error!)) : const CircularProgressIndicator())),
    );
  }
}

class _VariantRow {
  _VariantRow({this.id, String label = '', String qty = '1', this.unit = ItemUnit.pc, String price = '', String mrp = '', this.stock = StockState.in_})
      : label = TextEditingController(text: label),
        qty = TextEditingController(text: qty),
        price = TextEditingController(text: price),
        mrp = TextEditingController(text: mrp);

  final String? id;
  final TextEditingController label;
  final TextEditingController qty;
  final TextEditingController price;
  final TextEditingController mrp;
  ItemUnit unit;
  StockState stock;

  void dispose() {
    for (final c in [label, qty, price, mrp]) {
      c.dispose();
    }
  }
}

class ItemFormPage extends ConsumerStatefulWidget {
  const ItemFormPage({super.key, this.item, this.seed});
  final Item? item;
  final ItemFormSeed? seed;
  @override
  ConsumerState<ItemFormPage> createState() => _ItemFormPageState();
}

class _ItemFormPageState extends ConsumerState<ItemFormPage> {
  final _form = GlobalKey<FormState>();
  late final Item? _item = widget.item;
  late final MasterProduct? _master = widget.seed?.master;
  late final _name = TextEditingController(text: _item?.name ?? _master?.displayName ?? '');
  late final _nameTe = TextEditingController(text: _item?.nameTe ?? '');
  late final _description = TextEditingController(text: _item?.description ?? '');
  late final _leadTime = TextEditingController(text: _item?.leadTimeMin?.toString() ?? '');
  late final _capacity = TextEditingController(text: _item?.dailyCapacity?.toString() ?? '');
  late String? _category = _item?.categorySlug ?? _master?.categorySlug;
  late FoodMark? _food = _item?.foodMark;
  late final Set<String> _allergens = {...?_item?.allergens};
  late bool _madeToOrder = _item?.madeToOrder ?? false;
  late final Set<String> _days = {...?_item?.availableDays};
  late bool _special = _item?.specialOn != null;
  late bool _hidden = _item?.status == ItemStatus.hidden;
  late List<String> _imageIds = [...?_item?.images.map((m) => m.id)];
  late String? _imagePreview = _item?.images.firstOrNull?.thumbUrl ?? _item?.imageUrl ?? _master?.imageUrl;
  late final List<_VariantRow> _variants = _item != null
      ? [
          for (final v in _item.variants)
            _VariantRow(id: v.id, label: v.label, qty: _qty(v.unitQty), unit: v.unit, price: rupeeInput(v.pricePaise), mrp: rupeeInput(v.mrpPaise), stock: v.stock),
        ]
      : [
          _VariantRow(
            label: _master?.packLabel ?? '',
            qty: _master?.unitQty == null ? '1' : _qty(_master!.unitQty!),
            unit: _master?.unit ?? ItemUnit.pc,
            mrp: rupeeInput(_master?.mrpPaise),
          ),
        ];
  bool _busy = false;
  bool _uploading = false;
  String? _error;

  static String _qty(double q) => q == q.roundToDouble() ? q.toInt().toString() : q.toString();

  @override
  void dispose() {
    for (final c in [_name, _nameTe, _description, _leadTime, _capacity]) {
      c.dispose();
    }
    for (final v in _variants) {
      v.dispose();
    }
    super.dispose();
  }

  Future<void> _photo(bool camera) async {
    final l = AppLocalizations.of(context);
    final picked = await ref.read(photoPickerProvider)(camera: camera);
    if (picked == null || !mounted) return;
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final media = await ref.read(catalogueApiProvider).uploadPhoto(picked.bytes, contentType: picked.contentType, store: false);
      setState(() {
        _imageIds = [media.id];
        _imagePreview = media.thumbUrl;
      });
    } catch (e) {
      setState(() => _error = e is ApiException ? l.errPhoto : l.apiError(e));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Json _body(bool kitchen, bool food) {
    final variants = [
      for (final v in _variants)
        {
          'id': ?v.id,
          'label': v.label.text.trim().isEmpty ? '${v.qty.text.trim()} ${v.unit.name}' : v.label.text.trim(),
          'unit': v.unit.name,
          'unitQty': double.tryParse(v.qty.text.trim()) ?? 1,
          'pricePaise': paiseFrom(v.price.text)!,
          'mrpPaise': paiseFrom(v.mrp.text),
          'stock': v.stock.wire,
        },
    ];
    final today = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30)).toIso8601String().substring(0, 10);
    return {
      if (_item == null && _master != null) 'masterProductId': _master.id,
      'name': _name.text.trim(),
      'nameTe': _nameTe.text.trim().isEmpty ? null : _nameTe.text.trim(),
      'description': _description.text.trim().isEmpty ? null : _description.text.trim(),
      'categorySlug': _category,
      if (food) 'foodMark': _food?.wire,
      if (food) 'allergens': _allergens.toList(),
      'madeToOrder': _madeToOrder,
      'leadTimeMin': _madeToOrder ? int.tryParse(_leadTime.text.trim()) : null,
      if (kitchen) 'availableDays': weekDays.where(_days.contains).toList(),
      if (kitchen) 'dailyCapacity': int.tryParse(_capacity.text.trim()),
      if (kitchen) 'specialOn': _special ? today : null,
      'imageIds': _imageIds,
      'variants': variants,
      if (_item != null && _item.status != ItemStatus.pendingMerchant) 'hidden': _hidden,
    };
  }

  Future<void> _save(bool kitchen, bool food) async {
    final l = AppLocalizations.of(context);
    final english = Localizations.localeOf(context).languageCode == 'en';
    if (!_form.currentState!.validate()) return;
    if (food && _food == null) {
      setState(() => _error = l.itemFoodMarkMissing);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ref.read(catalogueApiProvider);
      final body = _body(kitchen, food);
      final saved = _item == null ? await api.create(body) : await api.update(_item.id, body);
      ref.read(analyticsProvider).track(_item == null ? 'catalogue_item_created' : 'catalogue_item_updated', {
        'source': _master != null ? 'barcode' : (widget.seed?.unknownBarcode != null ? 'unknown_barcode' : 'manual'),
        'status': saved.status.wire,
      });
      ref.read(catalogueProvider.notifier).saved(saved);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(saved.status == ItemStatus.inReview ? l.itemHeldNote : l.itemSaved)));
      context.pop(saved);
    } catch (e) {
      setState(() => _error = l.catalogueError(e, english: english));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final l = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(l.itemDeleteConfirm(_item!.name)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(MaterialLocalizations.of(c).cancelButtonLabel)),
          TextButton(key: const ValueKey('confirm-delete'), onPressed: () => Navigator.pop(c, true), child: Text(l.itemDelete)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(catalogueProvider.notifier).delete(_item!.id);
      if (mounted) context.pop();
    } catch (e) {
      setState(() => _error = l.apiError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final merchant = ref.watch(onboardingProvider).value?.merchant;
    final kitchen = merchant?.type == MerchantType.homeKitchen;
    final food = kitchen || (merchant?.sellsFood ?? false);
    final cats = ref.watch(categoriesProvider).value ?? const <Category>[];
    final te = Localizations.localeOf(context).languageCode == 'te';
    final client = ref.read(apiClientProvider);
    const gap = SizedBox(height: SanthaSpacing.s4);

    return Scaffold(
      appBar: AppBar(
        title: Text(_item == null ? l.itemNew : l.itemEdit),
        actions: [
          if (_item != null)
            IconButton(key: const ValueKey('item-delete'), tooltip: l.itemDelete, icon: const Icon(Icons.delete_outline), onPressed: _delete),
        ],
      ),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(SanthaSpacing.s6),
            children: [
              if (_master != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: SanthaSpacing.s4),
                  child: Text(l.itemFromMaster(_master.mrpPaise == null ? '—' : rupees(_master.mrpPaise!)), style: text.bodySmall?.copyWith(color: SanthaColors.leaf)),
                ),
              if (widget.seed?.unknownBarcode != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: SanthaSpacing.s4),
                  child: Text(l.scanUnknown, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                ),
              if (_item?.status == ItemStatus.inReview)
                Padding(
                  padding: const EdgeInsets.only(bottom: SanthaSpacing.s4),
                  child: Text(_item?.reviewReason ?? l.itemHeldNote, style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
                ),
              // Photo
              Row(children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(SanthaRadius.md),
                  child: SizedBox.square(
                    dimension: 88,
                    child: _uploading
                        ? const Center(child: CircularProgressIndicator())
                        : _imagePreview == null
                            ? const ColoredBox(color: SanthaColors.sky, child: Icon(Icons.add_a_photo, color: SanthaColors.indigo300))
                            : Image.network(client.resolve(_imagePreview!), fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: SanthaColors.sky)),
                  ),
                ),
                const SizedBox(width: SanthaSpacing.s4),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    TextButton.icon(key: const ValueKey('item-photo-camera'), onPressed: _uploading ? null : () => _photo(true), icon: const Icon(Icons.photo_camera), label: Text(l.photoTake)),
                    TextButton.icon(key: const ValueKey('item-photo-gallery'), onPressed: _uploading ? null : () => _photo(false), icon: const Icon(Icons.photo_library), label: Text(l.photoPick)),
                  ]),
                ),
              ]),
              gap,
              TextFormField(key: const ValueKey('item-name'), controller: _name, decoration: InputDecoration(labelText: l.itemName), validator: (v) => requiredField(l, v)),
              gap,
              TextFormField(controller: _nameTe, decoration: InputDecoration(labelText: l.itemNameTe)),
              gap,
              DropdownButtonFormField<String>(
                key: const ValueKey('item-category'),
                initialValue: cats.any((c) => c.slug == _category) ? _category : null,
                isExpanded: true,
                decoration: InputDecoration(labelText: l.itemCategory),
                items: [for (final c in cats) DropdownMenuItem(value: c.slug, child: Text(te ? c.nameTe : c.name))],
                onChanged: (v) => setState(() => _category = v),
                validator: (v) => v == null ? l.itemNoCategory : null,
              ),
              gap,
              Text(l.itemSizes, style: text.titleMedium),
              for (final (i, v) in _variants.indexed) _variantEditor(l, i, v),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: const ValueKey('item-add-size'),
                  onPressed: _variants.length >= 10 ? null : () => setState(() => _variants.add(_VariantRow(unit: _variants.last.unit))),
                  icon: const Icon(Icons.add),
                  label: Text(l.itemAddSize),
                ),
              ),
              if (food) ...[
                gap,
                Text(l.itemFoodMark, style: text.titleMedium),
                Wrap(spacing: SanthaSpacing.s2, children: [
                  for (final f in FoodMark.values)
                    ChoiceChip(key: ValueKey('food-${f.wire}'), label: Text(l.foodLabel(f)), selected: _food == f, onSelected: (_) => setState(() => _food = f)),
                ]),
                gap,
                Text(l.itemAllergens, style: text.titleMedium),
                Wrap(spacing: SanthaSpacing.s2, runSpacing: SanthaSpacing.s1, children: [
                  for (final a in allergens)
                    FilterChip(
                      label: Text(l.allergenLabel(a)),
                      selected: _allergens.contains(a),
                      onSelected: (on) => setState(() => on ? _allergens.add(a) : _allergens.remove(a)),
                    ),
                ]),
              ],
              gap,
              SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.itemMadeToOrder), value: _madeToOrder, onChanged: (v) => setState(() => _madeToOrder = v)),
              if (_madeToOrder)
                TextFormField(
                  controller: _leadTime,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(labelText: l.itemLeadTime),
                  validator: (v) => _madeToOrder && (int.tryParse(v ?? '') ?? 0) <= 0 ? l.errRequired : null,
                ),
              if (kitchen) ...[
                gap,
                Text(l.itemMenuDays, style: text.titleMedium),
                Text(_days.isEmpty ? l.itemMenuEveryDay : '', style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                Wrap(spacing: SanthaSpacing.s1, children: [
                  for (final d in weekDays)
                    FilterChip(label: Text(l.dayLabel(d)), selected: _days.contains(d), onSelected: (on) => setState(() => on ? _days.add(d) : _days.remove(d))),
                ]),
                gap,
                TextFormField(
                  controller: _capacity,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(labelText: l.itemDailyCapacity),
                ),
                SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.itemSpecialToday), value: _special, onChanged: (v) => setState(() => _special = v)),
              ],
              gap,
              TextFormField(controller: _description, maxLines: 3, maxLength: 1000, decoration: InputDecoration(labelText: l.itemDescription)),
              if (_item != null && _item.status != ItemStatus.pendingMerchant)
                SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.itemHide), value: _hidden, onChanged: (v) => setState(() => _hidden = v)),
              if (_error != null) ...[
                gap,
                Text(_error!, key: const ValueKey('item-error'), style: const TextStyle(color: SanthaColors.chilli)),
              ],
              const SizedBox(height: SanthaSpacing.s6),
              SanthaButton(key: const ValueKey('item-save'), label: l.save, loading: _busy, onPressed: _busy || _uploading ? null : () => _save(kitchen, food)),
              if (_item?.status == ItemStatus.pendingMerchant) ...[
                const SizedBox(height: SanthaSpacing.s3),
                SanthaButton(
                  key: const ValueKey('item-approve'),
                  label: l.itemApprove,
                  variant: SanthaButtonVariant.outline,
                  onPressed: _busy
                      ? null
                      : () async {
                          await ref.read(catalogueApiProvider).approvePending([_item!.id]);
                          await ref.read(catalogueProvider.notifier).reload();
                          if (context.mounted) context.pop();
                        },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _variantEditor(AppLocalizations l, int i, _VariantRow v) {
    String? price(String? s) {
      final p = paiseFrom(s ?? '');
      if (p == null || p <= 0) return l.errRequired;
      final mrp = paiseFrom(v.mrp.text) ?? _master?.mrpPaise;
      if (mrp != null && p > mrp) return l.itemPriceAboveMrp;
      return null;
    }

    return Padding(
      key: ValueKey('variant-$i'),
      padding: const EdgeInsets.only(top: SanthaSpacing.s3),
      child: Column(children: [
        Row(children: [
          Expanded(
            flex: 3,
            child: TextFormField(controller: v.label, decoration: InputDecoration(labelText: l.itemSizeLabel, hintText: l.itemSizeHint)),
          ),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(
            child: TextFormField(
              controller: v.qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l.itemQty),
              validator: (s) => (double.tryParse(s ?? '') ?? 0) > 0 ? null : l.errRequired,
            ),
          ),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(
            flex: 2,
            child: DropdownButtonFormField<ItemUnit>(
              initialValue: v.unit,
              isExpanded: true,
              decoration: InputDecoration(labelText: l.itemUnit),
              items: [for (final u in ItemUnit.values) DropdownMenuItem(value: u, child: Text(l.unitLabel(u)))],
              onChanged: (u) => setState(() => v.unit = u ?? v.unit),
            ),
          ),
        ]),
        Row(children: [
          Expanded(
            child: TextFormField(
              key: ValueKey('variant-$i-price'),
              controller: v.price,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l.itemPrice),
              validator: price,
            ),
          ),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(
            child: TextFormField(
              key: ValueKey('variant-$i-mrp'),
              controller: v.mrp,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l.itemMrp),
            ),
          ),
          if (_variants.length > 1)
            IconButton(
              tooltip: l.itemRemoveSize,
              icon: const Icon(Icons.remove_circle_outline),
              onPressed: () => setState(() => _variants.removeAt(i).dispose()),
            ),
        ]),
      ]),
    );
  }
}
