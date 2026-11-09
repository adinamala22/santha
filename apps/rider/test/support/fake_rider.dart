import 'dart:typed_data';

import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:rider/features/home/data/rider_controller.dart';
import 'package:rider/features/home/presentation/job_page.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

final testNow = DateTime.utc(2026, 11, 2, 7, 0);
const zones = [Zone('z1', 'Dargamitta', 'దర్గామిట్ట'), Zone('z2', 'Magunta Layout', 'మాగుంట లేఅవుట్')];

RiderOffer testOffer({String id = 'o1', int expiresInSec = 24}) => RiderOffer(
      id: id,
      expiresAt: testNow.add(Duration(seconds: expiresInSec)),
      payPaise: 4800,
      payLines: const [PayLine('base', 3000), PayLine('distance', 1400), PayLine('batch', 400)],
      storeName: 'Ramesh Stores',
      pickupDistanceM: 600,
      readyInMin: 5,
      dropArea: 'Magunta Layout',
      dropDistanceM: 1100,
    );

Job testJob({DeliveryState state = DeliveryState.assigned, String orderState = 'PREPARING', int codDuePaise = 15600, DateTime? arrivedAt, FailedReason? failedReason, DateTime? arrivedDropAt, bool photoProofAllowed = false}) => Job(
      id: 'j1',
      orderId: 'ord1',
      code: 'SN4821',
      mode: DeliveryMode.rider,
      state: state,
      orderState: orderState,
      storeName: 'Ramesh Stores',
      storeLine: '14-2-31, Dargamitta Main Road',
      store: const Point(14.4545, 79.992),
      dropName: 'Priya',
      dropLine: 'Flat 3B, Magunta Layout',
      dropLandmark: 'near Apollo Pharmacy',
      drop: const Point(14.46, 79.99),
      instructions: 'Leave at door if no answer; call first',
      itemCount: 3,
      codDuePaise: codDuePaise,
      payPaise: 4800,
      payLines: const [PayLine('base', 3000), PayLine('distance', 1800)],
      callNumber: '+918047112345',
      pickupCodeRequired: true,
      arrivedAt: arrivedAt,
      failedReason: failedReason,
      arrivedDropAt: arrivedDropAt,
      photoProofAllowed: photoProofAllowed,
    );

/// In-memory rider backend with the rules the screens rely on (codes, readiness, expiry).
class FakeRiderApi extends RiderApi {
  FakeRiderApi(super.client, {this.online = false, this.offer, List<Job>? jobs, this.status = RiderStatus.approved, this.statusNote, this.cashInHandPaise = 0, this.acceptancePct})
      : jobs = jobs ?? [];
  RiderStatus status;
  String? statusNote;
  int cashInHandPaise;
  int? acceptancePct;
  /// Job loads fail this many times (network), then work.
  int jobFailures = 0;
  bool online;
  RiderOffer? offer;
  final List<Job> jobs;
  List<String> zoneIds = [];
  final calls = <String>[];
  int deliveries = 0;
  int earned = 0;
  String pickupCode = '4812';
  String otp = '2468';
  bool ready = false;

  /// Status changes fail as if the phone had no network.
  bool offline = false;

  @override
  Future<RiderHome> home() async => RiderHome(
        name: 'Kiran',
        vehicle: 'bike',
        online: online,
        zones: zones.where((z) => zoneIds.contains(z.id)).toList(),
        allZones: zones,
        deliveriesToday: deliveries,
        earningsTodayPaise: earned,
        onlineMinToday: 320,
        offer: online ? offer : null,
        jobs: jobs.where((j) => j.state != DeliveryState.delivered).toList(),
        rating: 4.8,
        status: status,
        statusNote: statusNote,
        cashInHandPaise: cashInHandPaise,
        acceptancePct: acceptancePct,
      );

  // ── onboarding (ADR-029), with the server's rules ──
  String onbName = 'Rider';
  bool selfie = false;
  bool licencePhoto = false;
  int photoSeq = 0;
  RiderVehicle onbVehicle = RiderVehicle.bike;
  String? onbPlate;
  final checks = <KycKind, KycCheck>{};
  bool aadhaarOtpSent = false;

  KycCheck _check(KycKind kind, KycStatus s, {String? masked, String? public, String? reason}) =>
      checks[kind] = KycCheck(kind: kind, status: s, valueMasked: masked, valuePublic: public, failureReason: reason);

  RiderOnboarding _onb() {
    bool ok(KycKind k, {bool pending = false}) => checks[k]?.status == KycStatus.verified || (pending && checks[k]?.status == KycStatus.pending);
    return RiderOnboarding(
      status: status,
      statusNote: statusNote,
      name: onbName,
      vehicle: onbVehicle,
      vehicleNumber: onbPlate,
      editable: status == RiderStatus.draft || status == RiderStatus.rejected,
      steps: [
        RiderStep('profile', onbName != 'Rider' && (!onbVehicle.needsLicence || onbPlate != null)),
        RiderStep('selfie', selfie),
        RiderStep('identity', ok(KycKind.aadhaar) || ok(KycKind.pan)),
        RiderStep('driving_licence', !onbVehicle.needsLicence || (ok(KycKind.drivingLicence, pending: true) && licencePhoto)),
        RiderStep('bank', ok(KycKind.bank)),
      ],
      checks: checks.values.toList(),
      hasSelfie: selfie,
      hasLicencePhoto: licencePhoto,
    );
  }

  @override
  Future<String> uploadPhoto(Uint8List bytes, {required String kind, required String contentType, String? fulfilmentId}) async {
    calls.add('photo $kind${fulfilmentId == null ? '' : ' $fulfilmentId'}');
    if (kind == 'selfie') selfie = true;
    if (kind == 'licence') licencePhoto = true;
    return 'ph${++photoSeq}';
  }

  @override
  Future<Job> arrivedDrop(String id) async {
    calls.add('arrived-drop');
    final j = _get(id);
    final next = testJob(state: j.state, orderState: j.orderState, codDuePaise: j.codDuePaise, arrivedDropAt: testNow, photoProofAllowed: j.photoProofAllowed);
    _put(next);
    return next;
  }

  @override
  Future<Job> deliveredWithPhoto(String id, String photoId) async {
    calls.add('delivered-photo $photoId');
    final j = testJob(state: DeliveryState.delivered, orderState: 'DELIVERED');
    _put(j);
    deliveries += 1;
    return j;
  }

  @override
  Future<RiderOnboarding> onboarding() async => _onb();

  @override
  Future<RiderOnboarding> updateProfile({required String name, required RiderVehicle vehicle, String? vehicleNumber}) async {
    calls.add('profile $name ${vehicle.name} ${vehicleNumber ?? ''}'.trim());
    final plate = vehicleNumber?.toUpperCase().replaceAll(RegExp(r'[\s-]'), '');
    if (vehicle.needsLicence && (plate == null || !RegExp(r'^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$').hasMatch(plate))) {
      throw const ApiException(code: 'VALIDATION_FAILED', status: 400);
    }
    onbName = name;
    onbVehicle = vehicle;
    onbPlate = vehicle.needsLicence ? plate : null;
    return _onb();
  }

  @override
  Future<KycCheck> verifyPan({required String pan, required String name}) async {
    calls.add('pan $pan');
    return _check(KycKind.pan, pan.contains('0000') ? KycStatus.failed : KycStatus.verified, masked: 'AB******4K', reason: pan.contains('0000') ? 'PAN not found' : null);
  }

  @override
  Future<KycCheck> startAadhaar(String aadhaar) async {
    calls.add('aadhaar start');
    aadhaarOtpSent = true;
    return _check(KycKind.aadhaar, KycStatus.pending, masked: 'XXXX XXXX ${aadhaar.substring(aadhaar.length - 4)}');
  }

  @override
  Future<KycCheck> verifyAadhaar(String otp) async {
    calls.add('aadhaar verify $otp');
    final good = otp == '123456';
    return _check(KycKind.aadhaar, good ? KycStatus.verified : KycStatus.failed, masked: checks[KycKind.aadhaar]?.valueMasked, reason: good ? null : 'Wrong OTP');
  }

  @override
  Future<KycCheck> recordDrivingLicence(String number) async {
    calls.add('licence $number');
    return _check(KycKind.drivingLicence, KycStatus.pending, public: number.replaceAll(' ', ''));
  }

  @override
  Future<KycCheck> verifyBank({required String accountNumber, required String ifsc, required String holderName}) async {
    calls.add('bank $accountNumber $ifsc');
    return _check(KycKind.bank, KycStatus.verified, masked: '•••• ${accountNumber.substring(accountNumber.length - 4)}');
  }

  @override
  Future<RiderOnboarding> submit() async {
    calls.add('submit');
    if (!_onb().complete) throw const ApiException(code: 'CHECKLIST_INCOMPLETE', status: 422);
    status = RiderStatus.submitted;
    return _onb();
  }

  @override
  Future<RiderHome> setStatus({required bool online, List<String>? zones}) async {
    if (offline) throw const ApiException(code: ApiException.network, status: 0);
    calls.add('status $online ${zones?.join(',') ?? ''}');
    this.online = online;
    if (zones != null) zoneIds = zones;
    return home();
  }

  @override
  Future<void> sendLocation(double lat, double lng) async {
    calls.add('location');
    sent.add(Point(lat, lng));
  }

  @override
  Future<Job> accept(String offerId) async {
    calls.add('accept $offerId');
    if (offer?.id != offerId) throw const ApiException(code: 'OFFER_EXPIRED', status: 409);
    offer = null;
    final j = testJob(orderState: ready ? 'READY' : 'PREPARING');
    jobs.add(j);
    return j;
  }

  @override
  Future<void> decline(String offerId) async {
    calls.add('decline $offerId');
    offer = null;
  }

  Job _get(String id) => jobs.firstWhere((j) => j.id == id);
  void _put(Job j) => jobs[jobs.indexWhere((x) => x.id == j.id)] = j;

  @override
  Future<Job> job(String id) async {
    if (jobFailures > 0) {
      jobFailures--;
      throw const ApiException(code: ApiException.network, status: 0);
    }
    final j = _get(id);
    return ready && j.orderState == 'PREPARING' ? testJob(state: j.state, orderState: 'READY', arrivedAt: j.arrivedAt) : j;
  }

  @override
  Future<Job> arrived(String id) async {
    calls.add('arrived');
    final j = testJob(orderState: ready ? 'READY' : 'PREPARING', arrivedAt: testNow);
    _put(j);
    return j;
  }

  @override
  Future<Job> pickedUp(String id, String code) async {
    calls.add('picked $code');
    if (code != pickupCode) throw const ApiException(code: 'WRONG_CODE', status: 422);
    if (!ready) throw const ApiException(code: 'NOT_READY', status: 409);
    final j = testJob(state: DeliveryState.pickedUp, orderState: 'OUT_FOR_DELIVERY');
    _put(j);
    return j;
  }

  @override
  Future<Job> delivered(String id, {required String otp, int? codCollectedPaise}) async {
    calls.add('delivered $otp $codCollectedPaise');
    if (otp != this.otp) throw const ApiException(code: 'WRONG_CODE', status: 422);
    final j = testJob(state: DeliveryState.delivered, orderState: 'DELIVERED');
    _put(j);
    deliveries += 1;
    earned += 4800;
    return j;
  }

  @override
  Future<Job> failed(String id, FailedReason reason, {String? note}) async {
    calls.add('failed ${reason.wire} ${note ?? ''}'.trim());
    if (_get(id).state != DeliveryState.pickedUp) throw const ApiException(code: 'INVALID_STATE', status: 409);
    final j = testJob(state: DeliveryState.failed, orderState: 'FAILED_DELIVERY', failedReason: reason);
    _put(j);
    return j;
  }

  @override
  Future<Job> retry(String id) async {
    calls.add('retry');
    final j = testJob(state: DeliveryState.pickedUp, orderState: 'OUT_FOR_DELIVERY');
    _put(j);
    return j;
  }

  /// Positions sent to the server, in order.
  final sent = <Point>[];

  List<Payout> payoutList = [];

  @override
  Future<List<Payout>> payouts() async => payoutList;

  @override
  Future<RiderEarnings> earnings() async => RiderEarnings(earned, 320, [
        if (deliveries > 0) Earning('SN4821', testNow, 4800, const [PayLine('base', 3000), PayLine('distance', 1800)]),
      ]);
}

class Counter {
  int n = 0;
}

List<Override> riderOverrides(FakeRiderApi Function(SanthaApiClient) make, {required void Function(FakeRiderApi) onApi, FakeRealtime? realtime, Counter? rings, List<Uri>? launched, LiveLocations? liveLocations}) => [
      riderApiProvider.overrideWith((ref) {
        final api = make(ref.watch(apiClientProvider));
        onApi(api);
        return api;
      }),
      riderPollEveryProvider.overrideWithValue(null),
      liveLocationsProvider.overrideWithValue(liveLocations),
      riderNowProvider.overrideWith((ref) => Stream.value(testNow)),
      realtimeProvider.overrideWithValue(realtime ?? FakeRealtime()),
      offerAlertProvider.overrideWithValue(() => rings?.n++),
      locationSourceProvider.overrideWithValue(() async => const Point(14.455, 79.992)),
      launcherProvider.overrideWithValue((uri) async => launched?.add(uri)),
      photoTakerProvider.overrideWithValue(({bool front = false}) async => PickedPhoto(Uint8List.fromList([1, 2, 3]), front ? 'image/png' : 'image/jpeg')),
    ];
