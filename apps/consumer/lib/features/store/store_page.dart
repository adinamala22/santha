import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/discovery_providers.dart';
import '../../data/format.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import '../cart/cart_controller.dart';
import '../home/store_tile.dart';
import 'product_sheet.dart';
import 'reviews_sheet.dart';

/// Store page (wireframe 03) and home-kitchen page (wireframe 04).
class StorePageScreen extends ConsumerStatefulWidget {
  const StorePageScreen({super.key, required this.id, this.openItemId});
  final String id;

  /// Open this item's product sheet once the page loads (from a search result).
  final String? openItemId;

  @override
  ConsumerState<StorePageScreen> createState() => _StorePageScreenState();
}

class _StorePageScreenState extends ConsumerState<StorePageScreen> {
  String? _category;
  String _q = '';
  CartSlot? _slot;
  bool _openedItem = false;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final page = ref.watch(storePageProvider(widget.id));

    if (page case AsyncData(:final value) when !_openedItem && widget.openItemId != null) {
      _openedItem = true;
      final item = value.value.items.where((i) => i.id == widget.openItemId).firstOrNull;
      if (item != null) WidgetsBinding.instance.addPostFrameCallback((_) => mounted ? _openSheet(value.value, item) : null);
    }

    return Scaffold(
      backgroundColor: SanthaColors.white,
      body: switch (page) {
        AsyncData(:final value) => _content(context, value.value, stale: value.fresh ? null : value.savedAt),
        AsyncError(:final error) => Scaffold(
            appBar: AppBar(),
            body: error is ApiException && error.status == 404
                ? EmptyView(message: l.storeNotFound)
                : ErrorView(onRetry: () => ref.invalidate(storePageProvider(widget.id))),
          ),
        _ => Scaffold(appBar: AppBar(), body: const LoadingView()),
      },
      bottomNavigationBar: switch (page) {
        AsyncData(:final value) => CartBar(
            merchantId: value.value.store.id,
            action: value.value.isKitchen ? l.checkout : null,
            slotLabel: value.value.isKitchen && _slotFor(value.value) != null ? l.cartSlot(clock(_slotFor(value.value)!.start)) : null,
          ),
        _ => null,
      },
    );
  }

  /// Chosen slot: this page's pick, else the cart's (same kitchen), else the first open one.
  CartSlot? _slotFor(StorePage p) {
    if (_slot != null) return _slot;
    final cart = ref.watch(cartControllerProvider);
    if (cart.merchantId == p.store.id && cart.slot != null) return cart.slot;
    final first = p.slots?.where((s) => s.isOpen).firstOrNull;
    return first == null ? null : CartSlot(slotId: first.slotId, date: first.date, start: first.start);
  }

  bool _ensureSlot(StorePage p) {
    if (!p.isKitchen) return true;
    final slot = _slotFor(p);
    if (slot == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppLocalizations.of(context).pickSlotFirst)));
      return false;
    }
    ref.read(cartControllerProvider.notifier).setSlot(p.store.id, slot);
    return true;
  }

  void _afterAdd(StorePage p) {
    final slot = _slotFor(p);
    if (p.isKitchen && slot != null) ref.read(cartControllerProvider.notifier).setSlot(p.store.id, slot);
  }

  void _openSheet(StorePage p, StoreItem item) =>
      showProductSheet(context, ref, p, item, beforeAdd: () => _ensureSlot(p), afterAdd: () => _afterAdd(p));

  Widget _content(BuildContext context, StorePage p, {DateTime? stale}) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final lang = l.localeName;
    final q = _q.toLowerCase();
    final filtered = p.items.where((i) {
      if (_category != null && i.card.categorySlug != _category) return false;
      if (q.isEmpty) return true;
      return i.card.name.toLowerCase().contains(q) || (i.card.nameTe?.contains(_q) ?? false) || (i.card.brand?.toLowerCase().contains(q) ?? false);
    });
    // Kitchens: today's dishes first, otherwise in the order the API ranked them.
    final items = p.isKitchen ? [...filtered.where((i) => i.onMenuToday), ...filtered.where((i) => !i.onMenuToday)] : filtered.toList();

    return CustomScrollView(slivers: [
      SliverToBoxAdapter(child: _Hero(page: p)),
      if (stale != null) SliverToBoxAdapter(child: StaleBanner(savedAt: stale)),
      if (!p.deliversHere)
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s3, SanthaSpacing.s5, 0),
            child: Text(
              switch (p.notDeliveringReason) {
                NotDeliveringReason.tooFar when p.deliveryRadiusM > 0 => l.notDeliveringTooFar(distance(l, p.deliveryRadiusM)),
                NotDeliveringReason.otherArea => l.notDeliveringOtherArea,
                NotDeliveringReason.outsideServiceArea => l.notDeliveringOutside,
                _ => l.notDeliveringHere,
              },
              key: const ValueKey('not-delivering'), style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
          ),
        ),
      if (p.isKitchen) ..._kitchen(context, p, items) else ...[
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s4, SanthaSpacing.s5, 0),
          sliver: SliverToBoxAdapter(
            child: TextField(
              key: const ValueKey('store-search'),
              onChanged: (v) => setState(() => _q = v.trim()),
              decoration: InputDecoration(
                hintText: l.storeSearchHint,
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: SanthaColors.indigo100,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), borderSide: BorderSide.none),
              ),
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s3, SanthaSpacing.s5, SanthaSpacing.s3),
            child: Row(children: [
              _CategoryChip(label: l.allCategories, selected: _category == null, onTap: () => setState(() => _category = null)),
              for (final c in p.categories)
                _CategoryChip(
                  key: ValueKey('chip-${c.slug}'),
                  label: c.displayName(lang),
                  selected: _category == c.slug,
                  onTap: () => setState(() => _category = c.slug),
                ),
            ]),
          ),
        ),
        if (items.isEmpty)
          SliverToBoxAdapter(child: EmptyView(message: l.storeEmpty, icon: Icons.search_off))
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, 0, SanthaSpacing.s5, SanthaSpacing.s6),
            sliver: SliverGrid.builder(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 140,
                mainAxisSpacing: SanthaSpacing.s3,
                crossAxisSpacing: SanthaSpacing.s3,
                mainAxisExtent: 222,
              ),
              itemCount: items.length,
              itemBuilder: (_, i) => _RetailTile(page: p, item: items[i], onOpen: () => _openSheet(p, items[i])),
            ),
          ),
      ],
      SliverToBoxAdapter(child: _RatingsSection(store: p.store)),
    ]);
  }

  List<Widget> _kitchen(BuildContext context, StorePage p, List<StoreItem> items) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final slots = p.slots ?? const <SlotOpening>[];
    final nextOpen = slots.where((s) => s.isOpen).firstOrNull;
    final chosen = _slotFor(p);
    final allergens = {for (final i in p.items.where((i) => i.onMenuToday)) ...i.allergens};
    final now = DateTime.now();

    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s4, SanthaSpacing.s5, SanthaSpacing.s2),
        sliver: SliverToBoxAdapter(
          child: Text(nextOpen == null ? l.noSlotsToday : l.todaysMenu(istClock(nextOpen.cutoffAt)), style: text.titleSmall),
        ),
      ),
      SliverToBoxAdapter(
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s5),
          child: Row(children: [
            for (final s in slots)
              Padding(
                padding: const EdgeInsets.only(right: SanthaSpacing.s2),
                child: SlotChip(
                  key: ValueKey('slot-${s.slotId}-${s.date}'),
                  label: slotRange(s.start, s.end),
                  sublabel: !s.isOpen
                      ? (s.state == 'full' ? l.slotFull : l.slotClosed)
                      : dayWord(l, s.date, now) == l.dayToday
                          ? l.orderBy(istClock(s.cutoffAt))
                          : '${dayWord(l, s.date, now)} · ${l.orderBy(istClock(s.cutoffAt))}',
                  selected: chosen?.slotId == s.slotId && chosen?.date == s.date,
                  onTap: s.isOpen
                      ? () {
                          final slot = CartSlot(slotId: s.slotId, date: s.date, start: s.start);
                          setState(() => _slot = slot);
                          ref.read(analyticsProvider).track('slot_selected', {'merchant_id': p.store.id, 'slot_id': s.slotId, 'date': s.date, 'start': s.start});
                          ref.read(cartControllerProvider.notifier).setSlot(p.store.id, slot);
                        }
                      : null,
                ),
              ),
          ]),
        ),
      ),
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s4, SanthaSpacing.s5, 0),
        sliver: SliverList.separated(
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: SanthaSpacing.s3),
          itemBuilder: (_, i) => _KitchenRow(
            page: p,
            item: items[i],
            onOpen: () => _openSheet(p, items[i]),
            beforeAdd: () => _ensureSlot(p),
            afterAdd: () => _afterAdd(p),
          ),
        ),
      ),
      if (allergens.isNotEmpty)
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s4, SanthaSpacing.s5, SanthaSpacing.s6),
          sliver: SliverToBoxAdapter(
            child: Text(l.allergensLine(allergens.map((a) => allergenName(l, a)).join(', ')), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
          ),
        ),
    ];
  }
}

/// Store rating at the foot of the page; the breakdown and reviews open in a sheet.
class _RatingsSection extends StatelessWidget {
  const _RatingsSection({required this.store});
  final StoreSummary store;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final rating = store.rating;
    return Padding(
      key: const ValueKey('ratings-section'),
      padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s2, SanthaSpacing.s5, SanthaSpacing.s6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(l.reviewsTitle, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: SanthaSpacing.s2),
        if (rating == null || store.ratingCount == 0)
          Text(l.noRatingsYet, style: text.bodyMedium?.copyWith(color: SanthaColors.slate))
        else
          Row(children: [
            StarRow(value: rating, semanticLabel: l.ratedOutOf5(rating.toStringAsFixed(1))),
            const SizedBox(width: SanthaSpacing.s2),
            Expanded(child: Text('${rating.toStringAsFixed(1)} · ${l.ratingsCount(store.ratingCount)}', style: text.bodyMedium)),
            TextButton(
              key: const ValueKey('open-reviews'),
              style: TextButton.styleFrom(minimumSize: const Size(44, 44), foregroundColor: SanthaColors.indigo),
              onPressed: () => showStoreReviews(context, store.id),
              child: Text(l.seeReviews),
            ),
          ]),
      ]),
    );
  }
}

/// Photo with back button, and the info card overlapping it.
class _Hero extends ConsumerWidget {
  const _Hero({required this.page});
  final StorePage page;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final media = ref.watch(mediaUrlProvider);
    final s = page.store;
    final photo = page.photos.isNotEmpty ? page.photos.first : s.photoUrl;
    final area = page.microMarket == null ? null : (l.localeName == 'te' ? page.microMarket!.nameTe : page.microMarket!.name);
    final meta = [storeKind(l, s), ?area, distance(l, s.distanceM)].join(' · ');
    final info = [
      l.minOrder(rupees(s.movPaise)),
      if (page.freeDeliveryAbovePaise > 0) l.freeDeliveryOver(rupees(page.freeDeliveryAbovePaise)),
      if (page.returnPolicy != null) l.returnsPolicy(page.returnPolicy!),
    ].join(' · ');

    return Stack(children: [
      Column(children: [
        SizedBox(
          height: 180,
          width: double.infinity,
          child: photo == null
              ? const ColoredBox(color: SanthaColors.cream)
              : Image.network(media(photo)!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: SanthaColors.cream)),
        ),
        const SizedBox(height: 120),
      ]),
      Positioned(
        top: MediaQuery.paddingOf(context).top + SanthaSpacing.s2,
        left: SanthaSpacing.s2,
        child: Material(
          color: SanthaColors.white,
          shape: const CircleBorder(),
          child: IconButton(tooltip: l.back, icon: const Icon(Icons.arrow_back, color: SanthaColors.indigo), onPressed: () => context.canPop() ? context.pop() : context.go('/')),
        ),
      ),
      Positioned(
        left: SanthaSpacing.s5,
        right: SanthaSpacing.s5,
        top: 130,
        child: Container(
          padding: const EdgeInsets.all(SanthaSpacing.s4),
          decoration: BoxDecoration(
            color: SanthaColors.white,
            borderRadius: BorderRadius.circular(SanthaRadius.xl),
            border: Border.all(color: SanthaColors.indigo100, width: 1.5),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s.displayName(l.localeName), style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
            const SizedBox(height: SanthaSpacing.s2),
            Wrap(spacing: SanthaSpacing.s2, runSpacing: SanthaSpacing.s1, children: [
              if (s.rating != null)
                Semantics(
                  button: true,
                  label: '${l.ratedOutOf5(s.rating!.toStringAsFixed(1))}, ${l.ratingsCount(s.ratingCount)}. ${l.seeReviews}',
                  excludeSemantics: true,
                  child: GestureDetector(
                    key: const ValueKey('rating-badge'),
                    onTap: () => showStoreReviews(context, s.id),
                    child: TrustBadge(label: l.ratingWithCount(s.rating!.toStringAsFixed(1), s.ratingCount)),
                  ),
                )
              else
                TrustBadge(label: l.newOnSantha, positive: false),
              if (page.fssaiVerified) TrustBadge(label: l.fssaiOk, icon: Icons.verified_outlined),
              if (page.hygieneDeclared) TrustBadge(label: l.hygieneOk, icon: Icons.clean_hands_outlined),
              if (!page.isKitchen) etaChipFor(context, s),
              if (s.selfDelivers) SelfDeliversBadge(label: l.selfDelivers),
            ]),
            if (closedLabelFor(l, s) case final closed?) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s1), child: Text(closed, style: text.bodySmall?.copyWith(color: SanthaColors.chilli))),
            const SizedBox(height: SanthaSpacing.s2),
            Text(info, style: text.labelSmall?.copyWith(color: SanthaColors.slate)),
          ]),
        ),
      ),
    ]);
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: SanthaSpacing.s2),
        child: Semantics(
          selected: selected,
          button: true,
          child: Material(
            color: selected ? SanthaColors.indigo : SanthaColors.indigo100,
            shape: const StadiumBorder(),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s4, vertical: SanthaSpacing.s2),
                child: Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: selected ? SanthaColors.white : SanthaColors.ink)),
              ),
            ),
          ),
        ),
      );
}

class _RetailTile extends ConsumerWidget {
  const _RetailTile({required this.page, required this.item, required this.onOpen});
  final StorePage page;
  final StoreItem item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final media = ref.watch(mediaUrlProvider);
    final c = item.card;
    final out = item.stock == StockState.out;
    final canAdd = page.store.open && page.deliversHere && !out;
    return ProductTile(
      key: ValueKey('item-${c.id}'),
      name: '${c.displayName(l.localeName)} ${c.variantLabel}',
      price: rupees(c.pricePaise),
      mrp: c.mrpPaise != null && c.mrpPaise! > c.pricePaise ? rupees(c.mrpPaise!) : null,
      imageUrl: media(c.imageUrl),
      foodMark: foodMarkFor(context, c.foodMark),
      badge: out ? l.outOfStock : (c.stale ? l.checkStock : (item.stock == StockState.low ? l.lowStock : (c.variantCount > 1 ? l.sizesCount(c.variantCount) : null))),
      onTap: onOpen,
      add: CartAddButton(
        source: 'store',
        enabled: canAdd,
        add: CartAdd.fromCard(c, page.store, maxPerOrder: item.maxPerOrder),
      ),
    );
  }
}

/// Kitchen menu row (wireframe 04): food mark · name, "serves 2 · non-veg · 15 a day", price, ADD, photo.
class _KitchenRow extends ConsumerWidget {
  const _KitchenRow({required this.page, required this.item, required this.onOpen, required this.beforeAdd, required this.afterAdd});
  final StorePage page;
  final StoreItem item;
  final VoidCallback onOpen;
  final bool Function() beforeAdd;
  final VoidCallback afterAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final media = ref.watch(mediaUrlProvider);
    final c = item.card;
    final mark = switch (c.foodMark) {
      FoodMark.veg => l.veg,
      FoodMark.nonVeg => l.nonVeg,
      FoodMark.egg => l.egg,
      null => null,
    };
    final sub = [
      c.variantLabel,
      ?mark,
      if (item.dailyCapacity != null) l.portionsLeft(item.dailyCapacity!),
      if (item.special) l.special,
      if (!item.onMenuToday) l.notOnMenuToday,
    ].join(' · ');
    final canAdd = item.onMenuToday && page.deliversHere && item.stock != StockState.out;

    return Opacity(
      opacity: item.onMenuToday ? 1 : 0.55,
      child: Material(
        key: ValueKey('item-${c.id}'),
        color: SanthaColors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), side: const BorderSide(color: SanthaColors.indigo100, width: 1.5)),
        child: InkWell(
          borderRadius: BorderRadius.circular(SanthaRadius.lg),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.all(SanthaSpacing.s3),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if (foodMarkFor(context, c.foodMark) case final m?) ...[Padding(padding: const EdgeInsets.only(top: 3), child: m), const SizedBox(width: SanthaSpacing.s2)],
                    Expanded(child: Text(c.displayName(l.localeName), style: text.titleSmall)),
                  ]),
                  const SizedBox(height: SanthaSpacing.s1),
                  Text(sub, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                  const SizedBox(height: SanthaSpacing.s2),
                  Row(children: [
                    Expanded(child: Text(rupees(c.pricePaise), style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
                    CartAddButton(
                      source: 'store',
                      enabled: canAdd,
                      beforeAdd: beforeAdd,
                      afterAdd: afterAdd,
                      add: CartAdd.fromCard(c, page.store, maxPerOrder: item.maxPerOrder),
                    ),
                  ]),
                ]),
              ),
              const SizedBox(width: SanthaSpacing.s3),
              SanthaImage(url: media(c.imageUrl), size: 96, icon: Icons.restaurant, radius: SanthaRadius.md),
            ]),
          ),
        ),
      ),
    );
  }
}
