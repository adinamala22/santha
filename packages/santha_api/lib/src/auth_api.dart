import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'models.dart';

/// `/v1/auth/*` and `/v1/me`. Successful verify/refresh results are persisted to the token store.
class AuthApi {
  AuthApi(this.client, {required this.app, required this.platform});

  final SanthaApiClient client;
  final SanthaApp app;
  final ClientPlatform platform;

  Dio get _dio => client.dio;

  Future<OtpChallenge> requestOtp({required String phone, String locale = 'en'}) => _call(() async {
        final res = await _dio.post<Map<String, dynamic>>(
          '/v1/auth/otp/request',
          data: {'phone': phone, 'deviceId': client.deviceId, 'app': app.name, 'locale': locale},
          options: SanthaApiClient.publicOptions(),
        );
        return OtpChallenge.fromJson(res.data!);
      });

  Future<AuthSession> verifyOtp({required String challengeId, required String code, String? appVersion}) =>
      _call(() async {
        final res = await _dio.post<Map<String, dynamic>>(
          '/v1/auth/otp/verify',
          data: {
            'challengeId': challengeId,
            'code': code,
            'deviceId': client.deviceId,
            'app': app.name,
            'platform': platform.name,
            'appVersion': ?appVersion,
          },
          options: SanthaApiClient.publicOptions(),
        );
        final session = AuthSession.fromJson(res.data!);
        await client.tokens.write(session.tokens);
        return session;
      });

  Future<Me> me() => _call(() async {
        final res = await _dio.get<Map<String, dynamic>>('/v1/me');
        return Me.fromJson(res.data!);
      });

  /// Revokes the session server-side (best effort) and always clears local tokens.
  Future<void> logout() async {
    try {
      await _dio.post<void>('/v1/auth/logout');
    } on DioException {
      // offline or already expired — local sign-out still proceeds
    } finally {
      await client.tokens.clear();
    }
  }

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
