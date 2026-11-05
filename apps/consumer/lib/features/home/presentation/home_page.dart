import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../common/widgets.dart';
import '../../../data/discovery_providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../location/location_controller.dart';
import '../../location/location_page.dart';
import '../store_tile.dart';

/// Home categories → platform taxonomy slugs (category browse in search).
const homeCategories = [
  ('staples', Icons.rice_bowl_outlined),
  ('vegetables', Icons.eco_outlined),
  ('dairy', Icons.water_drop_outlined),
  ('otc_medicines', Icons.medication_outlined),
  ('bakery', Icons.bakery_dining_outlined),
  ('meat_fish', Icons.set_meal_outlined),
  ('snacks', Icons.cookie_outlined),
  ('household', Icons.cleaning_services_outlined),
];

String homeCategoryLabel(AppLocalizations l, String slug) => switch (slug) {
      'staples' => l.catGrocery,
      'vegetables' => l.catVegFruit,
      'dairy' => l.catDairy,
      'otc_medicines' => l.catPharmacy,
      'bakery' => l.catBakery,
      'meat_fish' => l.catMeatFish,
      'snacks' => l.catSnacks,
      _ => l.catHomeCare,
    };

String tabLabel(AppLocalizations l, FeedTab t) => switch (t) {
      FeedTab.stores => l.tabStores,
      FeedTab.fashion => l.tabFashion,
      FeedTab.homeKitchens => l.tabHomeKitchens,
      FeedTab.homeBusinesses => l.tabHomeBiz,
    };

/// Home (design/mockups/consumer-home-hifi.png): indigo header with location, ETA and search;
/// supply-type tabs; promo; category grid; stores near you.
class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  var _tab = FeedTab.stores;
  var _topRated = false;

  FeedQuery get _query => (tab: _tab, topRated: _topRated);

  @override
  Widget build(BuildContext context) {
    final loc = ref.watch(deliveryPointProvider);
    if (loc == null) return const Scaffold(body: LoadingView());
    final feed = loc.serviceable ? ref.watch(feedProvider(_query)) : null;
    final stores = feed?.value?.value.stores ?? const <StoreSummary>[];
    final fastest = stores.where((s) => s.open && s.deliverable && !s.eta.scheduled).map((s) => s.eta).fold<Eta?>(null, (a, e) => a == null || e.minMin < a.minMin ? e : a);

    return Scaffold(
      backgroundColor: SanthaColors.white,
      body: RefreshIndicator(
        color: SanthaColors.indigo,
        onRefresh: () async => ref.refresh(feedProvider(_query).future).ignore(),
        child: CustomScrollView(slivers: [
          SliverToBoxAdapter(
            child: _Header(
              location: loc,
              eta: fastest,
              tab: _tab,
              onTab: (t) => setState(() => _tab = t),
            ),
          ),
          if (!loc.serviceable)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(SanthaSpacing.s5),
                child: NotServiceableCard(onTryAnother: () => context.push('/location')),
              ),
            )
          else ...switch (feed!) {
            AsyncData(:final value) => _body(context, value.value, stale: value.fresh ? null : value.savedAt),
            AsyncError() => [SliverFillRemaining(hasScrollBody: false, child: ErrorView(onRetry: () => ref.invalidate(feedProvider(_query))))],
            _ => [const SliverToBoxAdapter(child: LoadingView())],
          },
        ]),
      ),
    );
  }

  List<Widget> _body(BuildContext context, Feed feed, {DateTime? stale}) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final pad = const EdgeInsets.symmetric(horizontal: SanthaSpacing.s5);
    final title = switch (_tab) {
      FeedTab.stores => l.storesNearYou,
      FeedTab.fashion => l.fashionNearYou,
      FeedTab.homeKitchens => l.kitchensNearYou,
      FeedTab.homeBusinesses => l.homeBizNearYou,
    };
    return [
      if (stale != null) SliverToBoxAdapter(child: StaleBanner(savedAt: stale)),
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s4, SanthaSpacing.s5, 0),
        sliver: SliverToBoxAdapter(
          child: PromoCard(
            title: l.promoTitle,
            subtitle: l.promoSubtitle,
            action: l.promoAction,
            onTap: () => context.go('/search?category=staples'),
          ),
        ),
      ),
      if (_tab == FeedTab.stores) ...[
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s6, SanthaSpacing.s5, SanthaSpacing.s3),
          sliver: SliverToBoxAdapter(child: Text(l.shopByCategory, style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700))),
        ),
        SliverPadding(
          padding: pad,
          sliver: SliverGrid.count(
            crossAxisCount: 4,
            mainAxisSpacing: SanthaSpacing.s3,
            crossAxisSpacing: SanthaSpacing.s3,
            childAspectRatio: 0.78,
            children: [
              for (final (slug, icon) in homeCategories)
                CategoryTile(
                  key: ValueKey('cat-$slug'),
                  label: homeCategoryLabel(l, slug),
                  icon: icon,
                  onTap: () => context.go('/search?category=$slug'),
                ),
            ],
          ),
        ),
      ],
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s6, SanthaSpacing.s5, SanthaSpacing.s3),
        sliver: SliverToBoxAdapter(
          child: Row(children: [
            Expanded(child: Text(title, style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700))),
            const SizedBox(width: SanthaSpacing.s2),
            FilterChip(
              key: const ValueKey('filter-top-rated'),
              avatar: const Icon(Icons.star_rounded, size: 18, color: SanthaColors.marigold),
              label: Text(l.filterTopRatedShort),
              tooltip: l.filterTopRated,
              selected: _topRated,
              showCheckmark: false,
              visualDensity: VisualDensity.compact,
              selectedColor: SanthaColors.marigold100,
              side: BorderSide(color: _topRated ? SanthaColors.marigold : SanthaColors.indigo100),
              onSelected: (on) => setState(() => _topRated = on),
            ),
          ]),
        ),
      ),
      if (feed.stores.isEmpty)
        SliverToBoxAdapter(child: EmptyView(message: _topRated ? l.topRatedEmpty : l.feedEmpty))
      else
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, 0, SanthaSpacing.s5, SanthaSpacing.s6),
          sliver: SliverList.separated(
            itemCount: feed.stores.length,
            separatorBuilder: (_, _) => const SizedBox(height: SanthaSpacing.s3),
            itemBuilder: (_, i) => StoreTile(store: feed.stores[i]),
          ),
        ),
    ];
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.location, required this.eta, required this.tab, required this.onTab});
  final DeliveryLocation location;
  final Eta? eta;
  final FeedTab tab;
  final ValueChanged<FeedTab> onTab;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final mm = location.serviceability.microMarket;
    final area = mm == null ? null : (l.localeName == 'te' ? mm.nameTe : mm.name);
    final place = switch (location.address) {
      final a? => '${addressLabel(l, a.label)} · ${area ?? a.line}',
      null => area ?? (location.source == LocationSource.gps ? l.currentLocationLabel : l.pinnedLocationLabel),
    };

    return Container(
      color: SanthaColors.indigo,
      padding: EdgeInsets.fromLTRB(SanthaSpacing.s5, MediaQuery.paddingOf(context).top + SanthaSpacing.s5, 0, SanthaSpacing.s5),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.only(right: SanthaSpacing.s5),
          child: Row(children: [
            Expanded(
              child: Semantics(
                button: true,
                label: '${l.deliverTo} $place. ${l.changeLocation}',
                excludeSemantics: true,
                child: InkWell(
                  key: const ValueKey('change-location'),
                  onTap: () => context.push('/location'),
                  child: Row(children: [
                    const Icon(Icons.location_on, color: SanthaColors.marigold, size: 32),
                    const SizedBox(width: SanthaSpacing.s3),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(l.deliverTo, style: text.bodySmall?.copyWith(color: SanthaColors.onDarkMuted)),
                        Row(children: [
                          Flexible(child: Text(place, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.titleMedium?.copyWith(color: SanthaColors.white))),
                          const Icon(Icons.keyboard_arrow_down, color: SanthaColors.white),
                        ]),
                      ]),
                    ),
                  ]),
                ),
              ),
            ),
            if (eta != null)
              DecoratedBox(
                decoration: const ShapeDecoration(color: SanthaColors.marigold, shape: StadiumBorder()),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s3, vertical: SanthaSpacing.s2),
                  child: Text('${eta!.minMin}–${eta!.maxMin} ${l.minUnit}', style: text.labelLarge?.copyWith(color: SanthaColors.indigo)),
                ),
              ),
          ]),
        ),
        const SizedBox(height: SanthaSpacing.s4),
        Padding(
          padding: const EdgeInsets.only(right: SanthaSpacing.s5),
          child: Semantics(
            button: true,
            label: l.searchHint,
            excludeSemantics: true,
            child: Material(
              key: const ValueKey('home-search'),
              color: SanthaColors.white,
              shape: const StadiumBorder(),
              child: InkWell(
                customBorder: const StadiumBorder(),
                onTap: () => context.go('/search'),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(SanthaSpacing.s5, SanthaSpacing.s2, SanthaSpacing.s2, SanthaSpacing.s2),
                  child: Row(children: [
                    Expanded(child: Text(l.searchHint, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.bodyMedium?.copyWith(color: SanthaColors.slate))),
                    const CircleAvatar(radius: 18, backgroundColor: SanthaColors.indigo, child: Icon(Icons.search, color: SanthaColors.white, size: 20)),
                  ]),
                ),
              ),
            ),
          ),
        ),
        if (location.serviceable) ...[
          const SizedBox(height: SanthaSpacing.s4),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final t in FeedTab.values)
                Padding(
                  padding: const EdgeInsets.only(right: SanthaSpacing.s2),
                  child: Semantics(
                    selected: t == tab,
                    button: true,
                    child: Material(
                      key: ValueKey('tab-${t.wire}'),
                      color: t == tab ? SanthaColors.marigold : SanthaColors.white.withValues(alpha: 0.12),
                      shape: const StadiumBorder(),
                      child: InkWell(
                        customBorder: const StadiumBorder(),
                        onTap: () => onTab(t),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: SanthaSpacing.s4, vertical: SanthaSpacing.s2),
                          child: Text(tabLabel(l, t), style: text.titleSmall?.copyWith(color: t == tab ? SanthaColors.indigo : SanthaColors.white)),
                        ),
                      ),
                    ),
                  ),
                ),
            ]),
          ),
        ],
      ]),
    );
  }
}
