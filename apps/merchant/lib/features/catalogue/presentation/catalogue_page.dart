import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../onboarding/data/onboarding_controller.dart';
import '../data/catalogue_controller.dart';
import 'catalogue_copy.dart';

/// Catalogue home (docs/wireframes/merchant/03-catalogue): search, filters, one-tap stock,
/// assisted items waiting for approval, and the daily "is your stock right?" check.
class CataloguePage extends ConsumerStatefulWidget {
  const CataloguePage({super.key});
  @override
  ConsumerState<CataloguePage> createState() => _CataloguePageState();
}

class _CataloguePageState extends ConsumerState<CataloguePage> {
  CatalogueFilter _filter = CatalogueFilter.all;
  String _query = '';
  bool _busy = false;

  Future<void> _act(Future<String> Function() action) async {
    final l = AppLocalizations.of(context);
    final english = Localizations.localeOf(context).languageCode == 'en';
    setState(() => _busy = true);
    try {
      final msg = await action();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.catalogueError(e, english: english))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final ctrl = ref.read(catalogueProvider.notifier);
    final kitchen = ref.watch(onboardingProvider).value?.merchant.type == MerchantType.homeKitchen;
    final async = ref.watch(catalogueProvider);
    final cats = ref.watch(categoriesProvider).value ?? const <Category>[];

    return Scaffold(
      appBar: AppBar(
        title: Text(l.catTitle),
        actions: [
          IconButton(key: const ValueKey('cat-add'), tooltip: l.catAdd, icon: const Icon(Icons.add), onPressed: () => context.push('/catalogue/item/new')),
          IconButton(key: const ValueKey('cat-import'), tooltip: l.catImport, icon: const Icon(Icons.upload_file), onPressed: () => context.push('/catalogue/import')),
          if (kitchen)
            IconButton(key: const ValueKey('cat-slots'), tooltip: l.catSlots, icon: const Icon(Icons.schedule), onPressed: () => context.push('/catalogue/slots')),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('cat-scan'),
        backgroundColor: SanthaColors.marigold,
        foregroundColor: SanthaColors.ink,
        onPressed: () => context.push('/catalogue/scan'),
        icon: const Icon(Icons.qr_code_scanner),
        label: Text(l.catScan),
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(SanthaSpacing.s6),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(l.catalogueError(e, english: false), textAlign: TextAlign.center),
              const SizedBox(height: SanthaSpacing.s4),
              SanthaButton(label: l.retry, onPressed: ctrl.reload),
            ]),
          ),
        ),
        data: (s) {
          final items = s.visible(_filter, _query);
          return RefreshIndicator(
            onRefresh: ctrl.reload,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(SanthaSpacing.s4, SanthaSpacing.s4, SanthaSpacing.s4, 96),
              children: [
                if (s.pending.isNotEmpty)
                  _Banner(
                    key: const ValueKey('pending-banner'),
                    color: SanthaColors.marigold100,
                    icon: Icons.inventory_2,
                    title: l.catPendingTitle,
                    body: l.catPendingSub(s.pending.length),
                    action: l.catApproveAll,
                    busy: _busy,
                    onAction: () => _act(() async => l.catApproved(await ctrl.approvePending())),
                  ),
                if (s.staleCount > 0)
                  _Banner(
                    key: const ValueKey('stale-banner'),
                    color: SanthaColors.sky,
                    icon: Icons.fact_check,
                    title: l.catStaleTitle,
                    body: l.catStaleSub(s.staleCount),
                    action: l.catConfirmAll,
                    busy: _busy,
                    onAction: () => _act(() async => l.catConfirmed(await ctrl.confirmAll())),
                  ),
                TextField(
                  key: const ValueKey('cat-search'),
                  decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.catSearch),
                  onChanged: (v) => setState(() => _query = v),
                ),
                const SizedBox(height: SanthaSpacing.s3),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(children: [
                    for (final f in CatalogueFilter.values)
                      Padding(
                        padding: const EdgeInsets.only(right: SanthaSpacing.s2),
                        child: ChoiceChip(
                          key: ValueKey('filter-${f.name}'),
                          label: Text(switch (f) {
                            CatalogueFilter.all => l.catFilterAll,
                            CatalogueFilter.out => l.catFilterOut,
                            CatalogueFilter.stale => l.catFilterStale,
                            CatalogueFilter.held => l.catFilterHeld,
                            CatalogueFilter.hidden => l.catFilterHidden,
                          }),
                          selected: _filter == f,
                          onSelected: (_) => setState(() => _filter = f),
                        ),
                      ),
                  ]),
                ),
                const SizedBox(height: SanthaSpacing.s2),
                Text(l.catCount(items.length), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SanthaColors.slate)),
                const SizedBox(height: SanthaSpacing.s2),
                if (items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s10),
                    child: Text(s.items.isEmpty ? l.catEmpty : l.catEmptyFilter, textAlign: TextAlign.center),
                  ),
                for (final i in items) _ItemTile(item: i, categories: cats),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({super.key, required this.color, required this.icon, required this.title, required this.body, required this.action, required this.onAction, required this.busy});
  final Color color;
  final IconData icon;
  final String title;
  final String body;
  final String action;
  final VoidCallback onAction;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s4),
      padding: const EdgeInsets.all(SanthaSpacing.s4),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(SanthaRadius.md)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, color: SanthaColors.indigo),
          const SizedBox(width: SanthaSpacing.s2),
          Expanded(child: Text(title, style: text.titleMedium)),
        ]),
        const SizedBox(height: SanthaSpacing.s2),
        Text(body, style: text.bodyMedium),
        const SizedBox(height: SanthaSpacing.s3),
        SanthaButton(label: action, loading: busy, onPressed: busy ? null : onAction),
      ]),
    );
  }
}

class _ItemTile extends ConsumerWidget {
  const _ItemTile({required this.item, required this.categories});
  final Item item;
  final List<Category> categories;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final thumb = item.images.where((m) => m.thumbUrl != null).firstOrNull?.thumbUrl ?? item.imageUrl;
    final client = ref.read(apiClientProvider);
    final badges = <(String, Color)>[
      if (item.status == ItemStatus.inReview) (l.catHeld, SanthaColors.chilli),
      if (item.status == ItemStatus.hidden) (l.catHidden, SanthaColors.slate),
      if (item.stale) (l.catStaleBadge, SanthaColors.indigo),
    ];
    return Card(
      key: ValueKey('item-${item.id}'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s3),
      child: InkWell(
        borderRadius: BorderRadius.circular(SanthaRadius.md),
        onTap: () => context.push('/catalogue/item/${item.id}'),
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s3),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(SanthaRadius.sm),
                child: SizedBox.square(
                  dimension: 56,
                  child: thumb == null
                      ? const ColoredBox(color: SanthaColors.sky, child: Icon(Icons.shopping_basket, color: SanthaColors.indigo300))
                      : Image.network(client.resolve(thumb), fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: SanthaColors.sky)),
                ),
              ),
              const SizedBox(width: SanthaSpacing.s3),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(item.name, style: text.titleSmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                  if (item.nameTe != null) Text(item.nameTe!, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                  const SizedBox(height: SanthaSpacing.s1),
                  Text(
                    [rupees(item.minPricePaise), if (item.variants.length > 1) l.catSizes(item.variants.length), categoryName(context, categories, item.categorySlug)].join(' · '),
                    style: text.bodySmall,
                  ),
                  if (badges.isNotEmpty)
                    Wrap(spacing: SanthaSpacing.s2, children: [
                      for (final (label, color) in badges) Text(label, style: text.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w600)),
                    ]),
                ]),
              ),
            ]),
            const SizedBox(height: SanthaSpacing.s2),
            _StockToggle(item: item),
          ]),
        ),
      ),
    );
  }
}

/// In / Low / Out for the whole item (every size) — the 2-minute daily availability update.
class _StockToggle extends ConsumerWidget {
  const _StockToggle({required this.item});
  final Item item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return Semantics(
      label: l.stockLabel(item.name),
      child: SegmentedButton<StockState>(
        key: ValueKey('stock-${item.id}'),
        showSelectedIcon: false,
        style: const ButtonStyle(visualDensity: VisualDensity.compact),
        segments: [
          for (final s in StockState.values) ButtonSegment(value: s, label: Text(l.stockName(s)), tooltip: l.stockName(s)),
        ],
        selected: {item.stock},
        onSelectionChanged: (sel) async {
          try {
            await ref.read(catalogueProvider.notifier).setStock(item, sel.first);
          } catch (e) {
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.catalogueError(e, english: false))));
            }
          }
        },
      ),
    );
  }
}
