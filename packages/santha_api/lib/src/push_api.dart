import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';

/// This phone's push registration for the signed-in person (FCM token).
class PushApi {
  PushApi(SanthaApiClient client) : _dio = client.dio;
  final Dio _dio;

  /// Registers (or replaces) this phone's token; the server keys it by the X-Device-Id header.
  Future<void> register(String token, String platform) => _call(() => _dio.put<void>('/v1/me/push-token', data: {'token': token, 'platform': platform}));

  /// Sign-out on this phone: its notifications stop.
  Future<void> unregister() => _call(() => _dio.delete<void>('/v1/me/push-token'));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
