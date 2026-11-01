import 'package:dio/dio.dart';

/// Typed API failure. `code` is the backend's stable error code (e.g. OTP_INVALID); apps map
/// codes to localised copy — never show `message` verbatim in Telugu builds.
class ApiException implements Exception {
  const ApiException({required this.code, required this.status, this.message, this.details = const {}});

  /// Network failures, timeouts and non-Santha responses.
  static const network = 'NETWORK';
  static const unknown = 'UNKNOWN';

  factory ApiException.fromDio(DioException e) {
    final res = e.response;
    if (res == null) return const ApiException(code: network, status: 0);
    final data = res.data;
    if (data is Map && data['error'] is Map) {
      final err = data['error'] as Map;
      return ApiException(
        code: (err['code'] as String?) ?? unknown,
        status: res.statusCode ?? 0,
        message: err['message'] as String?,
        details: (err['details'] as Map?)?.cast<String, dynamic>() ?? const {},
      );
    }
    return ApiException(code: unknown, status: res.statusCode ?? 0);
  }

  final String code;
  final int status;
  final String? message;
  final Map<String, dynamic> details;

  /// Seconds until a rate-limited action may be retried, when the server says so.
  int? get retryAfterSec => details['retryAfterSec'] as int?;
  int? get remainingAttempts => details['remainingAttempts'] as int?;

  @override
  String toString() => 'ApiException($status $code)';
}
