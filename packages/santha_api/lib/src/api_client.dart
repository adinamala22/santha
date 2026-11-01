import 'dart:async';

import 'package:dio/dio.dart';

import 'api_exception.dart';
import 'models.dart';
import 'token_store.dart';

/// Dio wrapper shared by every Santha app.
///
/// * Adds `X-Device-Id` to every request (tokens are bound to one install).
/// * Adds `Authorization: Bearer` when signed in.
/// * On a 401, refreshes once (single-flight: concurrent 401s share one refresh, because the
///   backend revokes the session if an old refresh token is replayed) and retries.
/// * If refresh fails, clears tokens and calls [onSessionExpired].
class SanthaApiClient {
  SanthaApiClient({
    required String baseUrl,
    required this.deviceId,
    required this.tokens,
    this.onSessionExpired,
    String? appVersion,
    Dio? dio,
  }) : dio = dio ?? Dio() {
    this.dio.options
      ..baseUrl = baseUrl
      ..connectTimeout = const Duration(seconds: 10)
      ..receiveTimeout = const Duration(seconds: 20)
      ..headers['X-Device-Id'] = deviceId;
    if (appVersion != null) this.dio.options.headers['X-App-Version'] = appVersion;
    this.dio.interceptors.add(QueuedInterceptorsWrapper(onRequest: _onRequest));
    this.dio.interceptors.add(InterceptorsWrapper(onError: _onError));
  }

  final Dio dio;
  final String deviceId;
  final TokenStore tokens;
  final void Function()? onSessionExpired;

  Future<TokenPair?>? _refreshing;

  static const _skipAuth = 'santha.skipAuth';
  static const _retried = 'santha.retried';

  /// Options for public endpoints (OTP, refresh) — never attach or refresh tokens.
  static Options publicOptions() => Options(extra: {_skipAuth: true});

  Future<void> _onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (options.extra[_skipAuth] != true) {
      final t = await tokens.read();
      if (t != null) options.headers['Authorization'] = 'Bearer ${t.accessToken}';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException err, ErrorInterceptorHandler handler) async {
    final req = err.requestOptions;
    final unauthorized = err.response?.statusCode == 401;
    if (!unauthorized || req.extra[_skipAuth] == true || req.extra[_retried] == true) {
      return handler.next(err);
    }
    final fresh = await refreshTokens();
    if (fresh == null) return handler.next(err);
    try {
      req.extra[_retried] = true;
      req.headers['Authorization'] = 'Bearer ${fresh.accessToken}';
      handler.resolve(await dio.fetch<dynamic>(req));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  /// Single-flight refresh. Returns null (and signs out) if the session cannot be refreshed.
  Future<TokenPair?> refreshTokens() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<TokenPair?> _doRefresh() async {
    final current = await tokens.read();
    if (current == null) return null;
    try {
      final res = await dio.post<Map<String, dynamic>>(
        '/v1/auth/refresh',
        data: {'refreshToken': current.refreshToken, 'deviceId': deviceId},
        options: publicOptions(),
      );
      final next = TokenPair.fromJson(res.data!);
      await tokens.write(next);
      return next;
    } on DioException catch (e) {
      final ex = ApiException.fromDio(e);
      if (ex.code != ApiException.network) {
        await tokens.clear();
        onSessionExpired?.call();
      }
      return null;
    }
  }
}
