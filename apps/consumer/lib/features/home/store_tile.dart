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
    return StoreCard(
      key: ValueKey('store-${store.id}'),
      name: name,
      meta: meta,
      imageUrl: media(store.photoUrl),
      eta: etaChipFor(context, store),
      selfDeliversLabel: store.selfDelivers ? l.selfDelivers : null,
      closedLabel: closedLabelFor(l, store),
      semanticsLabel: l.storeCardLabel(name, meta),
      onTap: () => context.push('/store/${store.id}'),
    );
  }
}
