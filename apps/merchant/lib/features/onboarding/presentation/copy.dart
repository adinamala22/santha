import 'package:santha_api/santha_api.dart';

import '../../../l10n/gen/app_localizations.dart';

/// Localised labels for onboarding enums and API errors.
extension OnboardingCopy on AppLocalizations {
  String stepTitle(ChecklistKey k) => switch (k) {
        ChecklistKey.business => stepBusiness,
        ChecklistKey.location => stepLocation,
        ChecklistKey.hours => stepHours,
        ChecklistKey.photos => stepPhotos,
        ChecklistKey.pan => stepPan,
        ChecklistKey.aadhaar => stepAadhaar,
        ChecklistKey.gst => stepGst,
        ChecklistKey.fssai => stepFssai,
        ChecklistKey.drugLicence => stepDrugLicence,
        ChecklistKey.bank => stepBank,
        ChecklistKey.hygiene => stepHygiene,
        ChecklistKey.returnPolicy => stepReturnPolicy,
      };

  String typeTitle(MerchantType t) => switch (t) {
        MerchantType.retail => onbTypeRetail,
        MerchantType.fashion => onbTypeFashion,
        MerchantType.homeBusiness => onbTypeHomeBusiness,
        MerchantType.homeKitchen => onbTypeHomeKitchen,
      };

  String typeSub(MerchantType t) => switch (t) {
        MerchantType.retail => onbTypeRetailSub,
        MerchantType.fashion => onbTypeFashionSub,
        MerchantType.homeBusiness => onbTypeHomeBusinessSub,
        MerchantType.homeKitchen => onbTypeHomeKitchenSub,
      };

  String category(String c) => switch (c) {
        'kirana' => catKirana,
        'supermarket' => catSupermarket,
        'pharmacy' => catPharmacy,
        'bakery' => catBakery,
        'meat_fish' => catMeatFish,
        'fruits_vegetables' => catFruitsVegetables,
        'stationery' => catStationery,
        'electronics' => catElectronics,
        _ => catOther,
      };

  String rejection(String? code) => switch (code) {
        'kyc_mismatch' => reasonKycMismatch,
        'fssai_invalid' => reasonFssaiInvalid,
        'documents_unclear' => reasonDocumentsUnclear,
        'outside_serviceable_area' => reasonOutsideArea,
        'restricted_category' => reasonRestricted,
        'duplicate_merchant' => reasonDuplicate,
        _ => reasonOther,
      };

  String dayLabel(String d) => switch (d) {
        'mon' => dayMon,
        'tue' => dayTue,
        'wed' => dayWed,
        'thu' => dayThu,
        'fri' => dayFri,
        'sat' => daySat,
        _ => daySun,
      };

  /// API error → message. Validation messages from the backend are English only, so they are not shown.
  String apiError(Object e) {
    if (e is! ApiException) return errorGeneric;
    return switch (e.code) {
      ApiException.network => errorNetwork,
      'VALIDATION_FAILED' => errValidation,
      'INVALID_STATE' => errLocked,
      'PROVIDER_UNAVAILABLE' => errProvider,
      'CHECKLIST_INCOMPLETE' => errChecklist,
      'ALREADY_EXISTS' => errDuplicateStaff,
      'RATE_LIMITED' => errorRateLimited,
      _ => errorGeneric,
    };
  }
}

const retailCategories = ['kirana', 'supermarket', 'pharmacy', 'bakery', 'meat_fish', 'fruits_vegetables', 'stationery', 'electronics', 'other'];
