import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../data/format.dart';
import '../../data/providers.dart';
import '../../l10n/gen/app_localizations.dart';

/// ETA chip for a store: ASAP range, or the next slot for home kitchens.
Widget etaChipFor(BuildContext context, StoreSummary s, {DateTime? now}) {
  final l = AppLocalizations.of(context);
  final e = s.eta;
  if (!e.scheduled) return EtaChip(minMinutes: e.minMin, maxMinutes: e.maxMin, unit: l.minUnit);
  final slot = e.nextSlot;
  if (slot == null) return ScheduledChip(label: l.noSlotsSoon);
  return ScheduledChip(label: l.nextSlot('${dayWord(l, slot.date, now ?? DateTime.now())} ${clock(slot.start)}'));
}

/// The greyed line on a store card: out of delivery range first (every store of the city is listed,
/// ADR-021), then closed with the next opening.
String? unavailableLabelFor(AppLocalizations l, StoreSummary s, {DateTime? now}) =>
    s.deliverable ? closedLabelFor(l, s, now: now) : l.deliveryNotAvailable;

String? closedLabelFor(AppLocalizations l, StoreSummary s, {DateTime? now}) {
  if (s.open) return null;
  final at = s.nextOpenAt;
  if (at == null) return l.closedNow;
  final ist = at.toUtc().add(const Duration(hours: 5, minutes: 30));
  final date = '${ist.year}-${ist.month.toString().padLeft(2, '0')}-${ist.day.toString().padLeft(2, '0')}';
  final day = dayWord(l, date, now ?? DateTime.now());
  return day == l.dayToday ? l.opensAt(istClock(at)) : l.opensOn(day, istClock(at));
}

/// A feed / search store card that opens the store page.
class StoreTile extends ConsumerWidget {
  const StoreTile({super.key, required this.store});
  final StoreSummary store;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final media = ref.watch(mediaUrlProvider);
    final meta = storeMeta(l, store);
    final name = store.displayName(l.localeName);
    final why = unavailableLabelFor(l, store);
    return StoreCard(
      key: ValueKey('store-${store.id}'),
      name: name,
      meta: meta,
      imageUrl: media(store.photoUrl),
      eta: store.deliverable ? etaChipFor(context, store) : null,
      selfDeliversLabel: !store.deliverable ? null : store.deliversAnywhere ? l.deliversAnywhere : (store.selfDelivers ? l.selfDelivers : null),
      closedLabel: why,
      // Beyond the store's radius it still delivers, at an extra charge (ADR-022).
      noticeLabel: store.deliverable && store.beyondRadius ? l.higherDeliveryCharge : null,
      semanticsLabel: [l.storeCardLabel(name, meta), ?why, if (store.deliverable && store.beyondRadius) l.higherDeliveryCharge].join('. '),
      onTap: () => context.push('/store/${store.id}'),
    );
  }
}
