import 'package:santha_api/santha_api.dart';

import '../l10n/gen/app_localizations.dart';

/// ₹ with Indian digit grouping; paise shown only when not whole rupees. Money stays integer paise.
String rupees(int paise) {
  final r = paise ~/ 100;
  final p = paise % 100;
  final s = r.toString();
  String grouped;
  if (s.length <= 3) {
    grouped = s;
  } else {
    final last3 = s.substring(s.length - 3);
    var rest = s.substring(0, s.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = '${parts.join(',')},$last3';
  }
  return p == 0 ? '₹$grouped' : '₹$grouped.${p.toString().padLeft(2, '0')}';
}

String distance(AppLocalizations l, int m) => m < 1000 ? l.distanceM(m) : l.distanceKm((m / 1000).toStringAsFixed(1));

/// "7:30 pm" from "19:30" (store-local IST times from the API).
String clock(String hhmm) {
  final [h, m] = hhmm.split(':').map(int.parse).toList();
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '$h12:${m.toString().padLeft(2, '0')} ${h < 12 ? 'am' : 'pm'}';
}

/// Slot range in the wireframe's short form: "12:30–1:00 pm", or "11:30 am–12:30 pm" across noon.
String slotRange(String start, String end) {
  final a = clock(start);
  final b = clock(end);
  final ap = a.substring(a.length - 2);
  return ap == b.substring(b.length - 2) ? '${a.substring(0, a.length - 3)}–$b' : '$a–$b';
}

/// IST wall-clock time of an instant, e.g. "11:00 am".
String istClock(DateTime t) {
  final ist = t.toUtc().add(const Duration(hours: 5, minutes: 30));
  return clock('${ist.hour}:${ist.minute}');
}

/// "today" / "tomorrow" / weekday name for an IST date (YYYY-MM-DD) relative to [now].
String dayWord(AppLocalizations l, String date, DateTime now) {
  final ist = now.toUtc().add(const Duration(hours: 5, minutes: 30));
  final today = DateTime.utc(ist.year, ist.month, ist.day);
  final d = DateTime.parse('${date}T00:00:00Z');
  final diff = d.difference(today).inDays;
  if (diff == 0) return l.dayToday;
  if (diff == 1) return l.dayTomorrow;
  const en = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const te = ['సోమ', 'మంగళ', 'బుధ', 'గురు', 'శుక్ర', 'శని', 'ఆది'];
  return (l.localeName == 'te' ? te : en)[d.weekday - 1];
}

/// Shop-type line for a store card: retail sub-category, or the supply type.
String storeKind(AppLocalizations l, StoreSummary s) => switch (s.type) {
      MerchantType.fashion => l.typeFashion,
      MerchantType.homeBusiness => l.typeHomeBusiness,
      MerchantType.homeKitchen => l.typeHomeKitchen,
      MerchantType.retail => switch (s.category) {
          'kirana' => l.storeCatKirana,
          'supermarket' => l.storeCatSupermarket,
          'pharmacy' => l.storeCatPharmacy,
          'bakery' => l.storeCatBakery,
          'meat_fish' => l.storeCatMeatFish,
          'fruits_vegetables' => l.storeCatFruitsVeg,
          'stationery' => l.storeCatStationery,
          'electronics' => l.storeCatElectronics,
          _ => l.storeCatOther,
        },
    };

/// "Grocery · 1.1 km · ★ 4.6"
String storeMeta(AppLocalizations l, StoreSummary s) =>
    [storeKind(l, s), distance(l, s.distanceM), if (s.rating != null) l.ratingShort(s.rating!.toStringAsFixed(1))].join(' · ');

String allergenName(AppLocalizations l, String a) => switch (a) {
      'gluten' => l.allergen_gluten,
      'milk' => l.allergen_milk,
      'egg' => l.allergen_egg,
      'peanut' => l.allergen_peanut,
      'tree_nuts' => l.allergen_tree_nuts,
      'soy' => l.allergen_soy,
      'fish' => l.allergen_fish,
      'shellfish' => l.allergen_shellfish,
      'sesame' => l.allergen_sesame,
      'mustard' => l.allergen_mustard,
      'celery' => l.allergen_celery,
      'sulphites' => l.allergen_sulphites,
      'lupin' => l.allergen_lupin,
      'molluscs' => l.allergen_molluscs,
      _ => a,
    };
