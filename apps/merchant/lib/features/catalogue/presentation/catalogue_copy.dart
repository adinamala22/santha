import 'package:flutter/widgets.dart';
import 'package:santha_api/santha_api.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../onboarding/presentation/copy.dart';

/// Localised labels for catalogue enums and formatting helpers.
extension CatalogueCopy on AppLocalizations {
  String unitLabel(ItemUnit u) => switch (u) {
        ItemUnit.kg => unitKg,
        ItemUnit.g => unitG,
        ItemUnit.l => unitL,
        ItemUnit.ml => unitMl,
        ItemUnit.pc => unitPc,
        ItemUnit.pack => unitPack,
        ItemUnit.portion => unitPortion,
      };

  String stockName(StockState s) => switch (s) {
        StockState.in_ => stockIn,
        StockState.low => stockLow,
        StockState.out => stockOut,
      };

  String foodLabel(FoodMark f) => switch (f) {
        FoodMark.veg => foodVeg,
        FoodMark.nonVeg => foodNonVeg,
        FoodMark.egg => foodEgg,
      };

  String allergenLabel(String a) => switch (a) {
        'gluten' => algGluten,
        'milk' => algMilk,
        'egg' => algEgg,
        'peanut' => algPeanut,
        'tree_nuts' => algTreeNuts,
        'soy' => algSoy,
        'fish' => algFish,
        'shellfish' => algShellfish,
        'sesame' => algSesame,
        'mustard' => algMustard,
        'celery' => algCelery,
        'sulphites' => algSulphites,
        'lupin' => algLupin,
        _ => algMolluscs,
      };

  /// Catalogue errors first, then the shared onboarding mapping. Validation messages from the
  /// API are English only, so they are shown only in the English app.
  String catalogueError(Object e, {required bool english}) {
    if (e is ApiException) {
      switch (e.code) {
        case 'BARCODE_UNKNOWN':
          return errBarcodeUnknown;
        case 'PAYLOAD_TOO_LARGE':
          return errTooLarge;
        case 'VALIDATION_FAILED':
          final problems = e.details['problems'];
          if (problems is List && problems.isNotEmpty) {
            final field = (problems.first as Map)['field']?.toString() ?? '';
            if (field.endsWith('pricePaise')) return itemPriceAboveMrp;
            if (field == 'foodMark') return itemFoodMarkMissing;
            if (field == 'categorySlug') return itemNoCategory;
          }
          if (english && e.message != null) return e.message!;
      }
    }
    return apiError(e);
  }
}

/// ₹ for display: whole rupees without decimals, otherwise two places.
String rupees(int paise) => paise % 100 == 0 ? '₹${paise ~/ 100}' : '₹${(paise / 100).toStringAsFixed(2)}';

/// "55", "55.5", "₹ 1,250.00" → paise; null if not a price.
int? paiseFrom(String text) {
  final s = text.replaceAll(RegExp(r'[₹,\s]'), '');
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(s)) return null;
  final parts = s.split('.');
  return int.parse(parts[0]) * 100 + (parts.length > 1 ? int.parse(parts[1].padRight(2, '0')) : 0);
}

String rupeeInput(int? paise) => paise == null ? '' : (paise % 100 == 0 ? '${paise ~/ 100}' : (paise / 100).toStringAsFixed(2));

/// Category name in the app's language.
String categoryName(BuildContext context, List<Category> all, String slug) {
  final c = all.where((x) => x.slug == slug).firstOrNull;
  if (c == null) return slug;
  return Localizations.localeOf(context).languageCode == 'te' ? c.nameTe : c.name;
}
