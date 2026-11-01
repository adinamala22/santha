import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'merchant_models.dart';
import 'models.dart';

/// `/v1/merchants/*` — merchant self-onboarding (merchant app). Errors are [ApiException]s with the
/// backend's codes (VALIDATION_FAILED, CHECKLIST_INCOMPLETE, INVALID_STATE, …).
class MerchantApi {
  MerchantApi(this.client);

  final SanthaApiClient client;
  Dio get _dio => client.dio;

  /// The signed-in owner's store, or null if they have not started one.
  Future<MerchantView?> mine() async {
    try {
      final res = await _dio.get<Json>('/v1/merchants/me');
      return MerchantView.fromJson(res.data!);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      throw ApiException.fromDio(e);
    }
  }

  Future<MerchantView> create({required MerchantType type, required String name, bool? sellsFood, String? category}) =>
      _view(() => _dio.post<Json>('/v1/merchants', data: {
            'type': type.wire,
            'name': name,
            'sellsFood': ?sellsFood,
            'category': ?category,
          }));

  /// Partial update; see UpdateMerchantDto for fields (profile fields lock after submission).
  Future<MerchantView> update(Json patch) => _view(() => _dio.patch<Json>('/v1/merchants/me', data: patch));

  Future<KycCheck> verifyPan({required String pan, required String name}) =>
      _kyc(() => _dio.put<Json>('/v1/merchants/me/kyc/pan', data: {'pan': pan, 'name': name}));

  Future<KycCheck> startAadhaar(String aadhaar) =>
      _kyc(() => _dio.post<Json>('/v1/merchants/me/kyc/aadhaar/start', data: {'aadhaar': aadhaar}));

  Future<KycCheck> verifyAadhaar(String otp) =>
      _kyc(() => _dio.post<Json>('/v1/merchants/me/kyc/aadhaar/verify', data: {'otp': otp}));

  Future<KycCheck> verifyGstin(String gstin) => _kyc(() => _dio.put<Json>('/v1/merchants/me/kyc/gstin', data: {'gstin': gstin}));

  Future<KycCheck> declareGstExemption(String reason) =>
      _kyc(() => _dio.put<Json>('/v1/merchants/me/kyc/gst-exemption', data: {'reason': reason}));

  Future<KycCheck> verifyFssai(String number) => _kyc(() => _dio.put<Json>('/v1/merchants/me/kyc/fssai', data: {'number': number}));

  Future<KycCheck> recordDrugLicence(String number) =>
      _kyc(() => _dio.put<Json>('/v1/merchants/me/kyc/drug-licence', data: {'number': number}));

  Future<KycCheck> verifyBank({required String accountNumber, required String ifsc, required String holderName}) =>
      _kyc(() => _dio.put<Json>('/v1/merchants/me/kyc/bank', data: {'accountNumber': accountNumber, 'ifsc': ifsc, 'holderName': holderName}));

  Future<Staff> addStaff({required String name, required String phone}) => _call(() async {
        final res = await _dio.post<Json>('/v1/merchants/me/staff', data: {'name': name, 'phone': phone});
        return Staff.fromJson(res.data!);
      });

  Future<void> removeStaff(String id) => _call(() => _dio.delete<void>('/v1/merchants/me/staff/$id'));

  Future<MerchantView> submit() => _view(() => _dio.post<Json>('/v1/merchants/me/submit'));

  Future<MerchantView> _view(Future<Response<Json>> Function() req) => _call(() async => MerchantView.fromJson((await req()).data!));
  Future<KycCheck> _kyc(Future<Response<Json>> Function() req) => _call(() async => KycCheck.fromJson((await req()).data!));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
