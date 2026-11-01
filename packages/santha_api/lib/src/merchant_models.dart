// Merchant onboarding models mirroring apps/backend/openapi.json (MerchantViewDto, KycCheckDto).
// Hand-written like the auth models (see ADR-006); a contract test parses a real API response.
import 'models.dart';

/// Enums whose API value (`wire`) is snake_case.
abstract interface class Wire {
  String get wire;
}

enum MerchantType implements Wire {
  retail('retail'),
  fashion('fashion'),
  homeBusiness('home_business'),
  homeKitchen('home_kitchen');

  const MerchantType(this.wire);
  @override
  final String wire;
}

enum MerchantStatus { draft, submitted, approved, rejected, live }

enum FulfilmentMode { self, rider }

enum KycKind implements Wire {
  pan('pan'),
  aadhaar('aadhaar'),
  gstin('gstin'),
  gstExemption('gst_exemption'),
  fssai('fssai'),
  bank('bank'),
  drugLicence('drug_licence');

  const KycKind(this.wire);
  @override
  final String wire;
}

enum KycStatus { pending, verified, failed }

/// Onboarding steps in the order the backend returns them (only those that apply are present).
enum ChecklistKey implements Wire {
  business('business'),
  location('location'),
  hours('hours'),
  pan('pan'),
  aadhaar('aadhaar'),
  gst('gst'),
  fssai('fssai'),
  drugLicence('drug_licence'),
  bank('bank'),
  hygiene('hygiene'),
  returnPolicy('return_policy');

  const ChecklistKey(this.wire);
  @override
  final String wire;
}

T _enum<T extends Enum>(List<T> values, String value) =>
    values.firstWhere((v) => (v is Wire ? (v as Wire).wire : v.name) == value);

class LatLng {
  const LatLng(this.lat, this.lng);
  factory LatLng.fromJson(Json j) => LatLng((j['lat'] as num).toDouble(), (j['lng'] as num).toDouble());
  final double lat;
  final double lng;
  Json toJson() => {'lat': lat, 'lng': lng};
}

class TimeRange {
  const TimeRange(this.open, this.close);
  factory TimeRange.fromJson(Json j) => TimeRange(j['open'] as String, j['close'] as String);
  final String open; // HH:MM, 24-hour, IST
  final String close;
  Json toJson() => {'open': open, 'close': close};
}

/// Weekly hours keyed mon…sun; an empty list means closed that day.
typedef WeeklyHours = Map<String, List<TimeRange>>;

const weekDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

WeeklyHours weeklyHoursFromJson(Json j) =>
    {for (final d in weekDays) d: ((j[d] as List?) ?? const []).map((r) => TimeRange.fromJson(r as Json)).toList()};

Json weeklyHoursToJson(WeeklyHours h) => {for (final d in weekDays) d: (h[d] ?? const []).map((r) => r.toJson()).toList()};

class KycCheck {
  const KycCheck({
    required this.kind,
    required this.status,
    this.valueMasked,
    this.valuePublic,
    this.nameOnRecord,
    this.failureReason,
    this.verifiedAt,
  });

  factory KycCheck.fromJson(Json j) => KycCheck(
        kind: _enum(KycKind.values, j['kind'] as String),
        status: _enum(KycStatus.values, j['status'] as String),
        valueMasked: j['valueMasked'] as String?,
        valuePublic: j['valuePublic'] as String?,
        nameOnRecord: j['nameOnRecord'] as String?,
        failureReason: j['failureReason'] as String?,
        verifiedAt: j['verifiedAt'] == null ? null : DateTime.parse(j['verifiedAt'] as String),
      );

  final KycKind kind;
  final KycStatus status;
  final String? valueMasked;
  final String? valuePublic;
  final String? nameOnRecord;
  final String? failureReason;
  final DateTime? verifiedAt;

  /// What to show for the number: public identifiers in full, PAN/Aadhaar/bank masked.
  String? get display => valuePublic ?? valueMasked;
}

class Staff {
  const Staff({required this.id, required this.name, required this.phoneMasked});
  factory Staff.fromJson(Json j) => Staff(id: j['id'] as String, name: j['name'] as String, phoneMasked: j['phoneMasked'] as String);
  final String id;
  final String name;
  final String phoneMasked;
}

class MicroMarketRef {
  const MicroMarketRef({required this.id, required this.slug, required this.name, required this.nameTe});
  factory MicroMarketRef.fromJson(Json j) =>
      MicroMarketRef(id: j['id'] as String, slug: j['slug'] as String, name: j['name'] as String, nameTe: j['nameTe'] as String);
  final String id;
  final String slug;
  final String name;
  final String nameTe;
}

class Merchant {
  const Merchant({
    required this.id,
    required this.type,
    required this.sellsFood,
    required this.name,
    required this.status,
    required this.radiusM,
    required this.movPaise,
    required this.defaultFulfilment,
    this.category,
    this.nameTe,
    this.description,
    this.addressLine,
    this.landmark,
    this.pincode,
    this.location,
    this.hours,
    this.returnPolicy,
    this.hygieneDeclaredAt,
    this.rejectionCode,
    this.rejectionNote,
  });

  factory Merchant.fromJson(Json j) => Merchant(
        id: j['id'] as String,
        type: _enum(MerchantType.values, j['type'] as String),
        sellsFood: j['sellsFood'] as bool,
        category: j['category'] as String?,
        name: j['name'] as String,
        nameTe: j['nameTe'] as String?,
        description: j['description'] as String?,
        addressLine: j['addressLine'] as String?,
        landmark: j['landmark'] as String?,
        pincode: j['pincode'] as String?,
        location: j['location'] == null ? null : LatLng.fromJson(j['location'] as Json),
        radiusM: j['radiusM'] as int,
        hours: j['hours'] == null ? null : weeklyHoursFromJson(j['hours'] as Json),
        movPaise: j['movPaise'] as int,
        defaultFulfilment: _enum(FulfilmentMode.values, j['defaultFulfilment'] as String),
        returnPolicy: j['returnPolicy'] as String?,
        hygieneDeclaredAt: j['hygieneDeclaredAt'] == null ? null : DateTime.parse(j['hygieneDeclaredAt'] as String),
        status: _enum(MerchantStatus.values, j['status'] as String),
        rejectionCode: j['rejectionCode'] as String?,
        rejectionNote: j['rejectionNote'] as String?,
      );

  final String id;
  final MerchantType type;
  final bool sellsFood;
  final String? category;
  final String name;
  final String? nameTe;
  final String? description;
  final String? addressLine;
  final String? landmark;
  final String? pincode;
  final LatLng? location;
  final int radiusM;
  final WeeklyHours? hours;
  final int movPaise;
  final FulfilmentMode defaultFulfilment;
  final String? returnPolicy;
  final DateTime? hygieneDeclaredAt;
  final MerchantStatus status;
  final String? rejectionCode;
  final String? rejectionNote;

  /// Food sellers need FSSAI (every home kitchen, and retail/home businesses that sell food).
  bool get needsFssai => type == MerchantType.homeKitchen || sellsFood;
  bool get editable => status == MerchantStatus.draft || status == MerchantStatus.rejected;
}

class ChecklistItem {
  const ChecklistItem(this.key, this.done);
  factory ChecklistItem.fromJson(Json j) => ChecklistItem(_enum(ChecklistKey.values, j['key'] as String), j['done'] as bool);
  final ChecklistKey key;
  final bool done;
}

/// `GET /v1/merchants/me` and every onboarding mutation return this.
class MerchantView {
  const MerchantView({
    required this.merchant,
    required this.staff,
    required this.kyc,
    required this.checklist,
    required this.canSubmit,
    this.microMarket,
  });

  factory MerchantView.fromJson(Json j) => MerchantView(
        merchant: Merchant.fromJson(j['merchant'] as Json),
        microMarket: j['microMarket'] == null ? null : MicroMarketRef.fromJson(j['microMarket'] as Json),
        staff: (j['staff'] as List).map((s) => Staff.fromJson(s as Json)).toList(),
        kyc: (j['kyc'] as List).map((k) => KycCheck.fromJson(k as Json)).toList(),
        checklist: (j['checklist'] as List).map((c) => ChecklistItem.fromJson(c as Json)).toList(),
        canSubmit: j['canSubmit'] as bool,
      );

  final Merchant merchant;
  final MicroMarketRef? microMarket;
  final List<Staff> staff;
  final List<KycCheck> kyc;
  final List<ChecklistItem> checklist;
  final bool canSubmit;

  KycCheck? check(KycKind kind) => kyc.where((k) => k.kind == kind).firstOrNull;
  bool done(ChecklistKey key) => checklist.any((c) => c.key == key && c.done);

  MerchantView withKyc(KycCheck c) => MerchantView(
        merchant: merchant,
        microMarket: microMarket,
        staff: staff,
        kyc: [...kyc.where((k) => k.kind != c.kind), c],
        checklist: checklist,
        canSubmit: canSubmit,
      );
}
