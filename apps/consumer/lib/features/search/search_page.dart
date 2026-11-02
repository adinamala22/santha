import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../common/widgets.dart';
import '../../data/discovery_providers.dart';
import '../../data/format.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';
import '../cart/cart_controller.dart';
import '../home/presentation/home_page.dart' show homeCategoryLabel;
import '../home/store_tile.dart';
import '../location/location_controller.dart';

/// Search (wireframe 02): results grouped by store with inline ADD, "did you mean" Telugu hints,
/// category browse when opened from a home category tile.
class SearchPage extends ConsumerStatefulWidget {
  const SearchPage({super.key, this.initialQuery = '', this.category});
  final String initialQuery;
  final String? category;

  @override
  ConsumerState<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends ConsumerState<SearchPage> {
  late final _field = TextEditingController(text: widget.initialQuery);
  late String _q = widget.initialQuery;
  late String? _category = widget.category;
  Timer? _debounce;

  @override
  void didUpdateWidget(SearchPage old) {
    super.didUpdateWidget(old);
    if (old.category != widget.category || old.initialQuery != widget.initialQuery) {
      _field.text = widget.initialQuery;
      setState(() {
        _q = widget.initialQuery;
        _category = widget.category;
      });
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _field.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) setState(() => _q = v.trim());
    });
  }

  void _submit(String v) {
    _debounce?.cancel();
    setState(() => _q = v.trim());
  }

  void _useHint(String h) {
    _field.text = h;
    _submit(h);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final active = _q.isNotEmpty || _category != null;
    final query = (q: _q, category: _q.isEmpty ? _category : null);
    final results = active && ref.watch(deliveryPointProvider) != null ? ref.watch(searchProvider(query)) : null;

    return Scaffold(
      backgroundColor: SanthaColors.white,
      appBar: AppBar(
        backgroundColor: SanthaColors.white,
        surfaceTintColor: SanthaColors.white,
        titleSpacing: context.canPop() ? 0 : SanthaSpacing.s4,
        title: TextField(
          key: const ValueKey('search-field'),
          controller: _field,
          autofocus: widget.category == null && widget.initialQuery.isEmpty,
          textInputAction: TextInputAction.search,
          onChanged: _onChanged,
          onSubmitted: _submit,
          decoration: InputDecoration(
            hintText: _category != null && _q.isEmpty ? homeCategoryLabel(l, _category!) : l.searchHint,
            filled: true,
            fillColor: SanthaColors.indigo100,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), borderSide: BorderSide.none),
            contentPadding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s4, vertical: SanthaSpacing.s3),
            suffixIcon: _field.text.isEmpty && _category == null
                ? null
                : IconButton(
                    tooltip: l.clearSearch,
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      _field.clear();
                      setState(() {
                        _q = '';
                        _category = null;
                      });
                    },
                  ),
          ),
        ),
      ),
      body: switch (results) {
        null => EmptyView(message: l.searchPrompt, icon: Icons.search),
        AsyncData(:final value) => _Results(result: value, onHint: _useHint, title: _q.isEmpty && _category != null ? homeCategoryLabel(l, _category!) : null),
        AsyncError() => ErrorView(onRetry: () => ref.invalidate(searchProvider(query))),
        _ => const LoadingView(),
      },
      bottomNavigationBar: const CartBar(),
    );
  }
}

class _Results extends StatelessWidget {
  const _Results({required this.result, required this.onHint, this.title});
  final SearchResult result;
  final ValueChanged<String> onHint;
  final String? title;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final hints = result.hints;
    return ListView(
      padding: const EdgeInsets.fromLTRB(SanthaSpacing.s4, 0, SanthaSpacing.s4, SanthaSpacing.s6),
      children: [
        if (title != null) Padding(padding: const EdgeInsets.only(bottom: SanthaSpacing.s2), child: Text(title!, style: text.titleLarge)),
        if (hints.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: SanthaSpacing.s3),
            child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: SanthaSpacing.s1, children: [
              Text(l.didYouMean, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
              for (final h in hints)
                ActionChip(
                  key: ValueKey('hint-$h'),
                  label: Text(h),
                  visualDensity: VisualDensity.compact,
                  backgroundColor: SanthaColors.indigo100,
                  side: BorderSide.none,
                  onPressed: () => onHint(h),
                ),
            ]),
          ),
        if (result.zeroResult || (result.groups.isEmpty && result.stores.isEmpty))
          EmptyView(message: l.searchNoResults(result.query), icon: Icons.search_off),
        if (result.stores.isNotEmpty) ...[
          Text(l.matchingStores, style: text.titleMedium),
          const SizedBox(height: SanthaSpacing.s2),
          for (final s in result.stores) Padding(padding: const EdgeInsets.only(bottom: SanthaSpacing.s3), child: StoreTile(store: s)),
        ],
        for (final g in result.groups) Padding(padding: const EdgeInsets.only(bottom: SanthaSpacing.s3), child: _StoreGroup(group: g)),
      ],
    );
  }
}

/// One store's matches: header (name · ETA · self-delivers) and a row of items with ADD.
class _StoreGroup extends ConsumerWidget {
  const _StoreGroup({required this.group});
  final SearchGroup group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final s = group.store;
    final eta = s.eta.scheduled ? null : '${s.eta.minMin}–${s.eta.maxMin} ${l.minUnit}';
    final header = [s.displayName(l.localeName), ?eta, if (s.selfDelivers) l.selfDelivers].join(' · ');
    return Container(
      key: ValueKey('group-${s.id}'),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(SanthaRadius.lg), border: Border.all(color: SanthaColors.indigo100, width: 1.5)),
      padding: const EdgeInsets.all(SanthaSpacing.s3),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        InkWell(
          onTap: () => context.push('/store/${s.id}'),
          child: Row(children: [
            Expanded(child: Text(header, style: text.titleSmall?.copyWith(color: SanthaColors.indigo), maxLines: 1, overflow: TextOverflow.ellipsis)),
            const Icon(Icons.chevron_right, color: SanthaColors.indigo),
          ]),
        ),
        if (!s.open) Text(closedLabelFor(l, s) ?? '', style: text.bodySmall?.copyWith(color: SanthaColors.chilli)),
        const SizedBox(height: SanthaSpacing.s2),
        SizedBox(
          height: 186,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: group.items.length,
            separatorBuilder: (_, _) => const SizedBox(width: SanthaSpacing.s3),
            itemBuilder: (_, i) => _SearchItem(item: group.items[i], store: s),
          ),
        ),
        if (group.more > 0)
          TextButton(onPressed: () => context.push('/store/${s.id}'), child: Text(l.searchMore(group.more))),
      ]),
    );
  }
}

class _SearchItem extends ConsumerWidget {
  const _SearchItem({required this.item, required this.store});
  final ItemCard item;
  final StoreSummary store;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final media = ref.watch(mediaUrlProvider);
    return SizedBox(
      width: 118,
      child: InkWell(
        onTap: () => context.push('/store/${store.id}?item=${item.id}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Stack(children: [
            SanthaImage(url: media(item.imageUrl), size: 118, icon: Icons.shopping_basket, radius: SanthaRadius.sm),
            Positioned(
              top: SanthaSpacing.s1,
              right: SanthaSpacing.s1,
              child: CartAddButton(add: CartAdd.fromCard(item, store), source: 'search', enabled: store.open),
            ),
          ]),
          const SizedBox(height: SanthaSpacing.s1),
          Text('${item.displayName(l.localeName)} ${item.variantLabel}', maxLines: 2, overflow: TextOverflow.ellipsis, style: text.bodySmall?.copyWith(color: SanthaColors.ink)),
          Text.rich(TextSpan(children: [
            TextSpan(text: rupees(item.pricePaise), style: text.bodySmall?.copyWith(fontWeight: FontWeight.w700, color: SanthaColors.ink)),
            if (item.mrpPaise != null && item.mrpPaise! > item.pricePaise)
              TextSpan(text: '  ${l.mrpLabel(rupees(item.mrpPaise!))}', style: text.labelSmall?.copyWith(color: SanthaColors.slate, decoration: TextDecoration.lineThrough)),
          ])),
        ]),
      ),
    );
  }
}
