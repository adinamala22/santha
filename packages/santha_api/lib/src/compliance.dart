// Trust & safety and DPDP (M8): consents, data-principal requests, grievances, store reviews.
import 'dart:convert';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'discovery_models.dart';
import 'models.dart';

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);

class Consent {
  const Consent({required this.purpose, required this.granted, required this.current, this.at});
  factory Consent.fromJson(Json j) => Consent(purpose: j['purpose'] as String, granted: j['granted'] as bool, current: j['current'] as bool, at: _date(j['at']));
  /// terms | privacy | marketing | whatsapp_updates
  final String purpose;
  final bool granted;
  /// Given for the notice version in force.
  final bool current;
  final DateTime? at;
}

class DataRequest {
  const DataRequest({required this.id, required this.type, required this.status, required this.exportReady, required this.createdAt});
  factory DataRequest.fromJson(Json j) =>
      DataRequest(id: j['id'] as String, type: j['type'] as String, status: j['status'] as String, exportReady: j['exportReady'] as bool, createdAt: DateTime.parse(j['createdAt'] as String));
  /// access | correction | erasure
  final String type;
  final String id;
  /// open | completed | rejected
  final String status;
  final bool exportReady;
  final DateTime createdAt;
}

class Grievance {
  const Grievance({required this.id, required this.category, required this.description, required this.status, required this.resolveDueAt, required this.createdAt, this.resolution});
  factory Grievance.fromJson(Json j) => Grievance(
        id: j['id'] as String,
        category: j['category'] as String,
        description: j['description'] as String,
        status: j['status'] as String,
        resolution: j['resolution'] as String?,
        resolveDueAt: DateTime.parse(j['resolveDueAt'] as String),
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final String id;
  final String category;
  final String description;
  /// open | acknowledged | resolved
  final String status;
  final String? resolution;
  final DateTime resolveDueAt;
  final DateTime createdAt;
}

class StoreReview {
  const StoreReview({required this.orderId, required this.storeStars, required this.createdAt, this.comment, this.reply});
  factory StoreReview.fromJson(Json j) =>
      StoreReview(orderId: j['orderId'] as String, storeStars: j['storeStars'] as int, comment: j['comment'] as String?, reply: j['reply'] as String?, createdAt: DateTime.parse(j['createdAt'] as String));
  final String orderId;
  final int storeStars;
  final String? comment;
  final String? reply;
  final DateTime createdAt;
}

/// Shared by all three apps.
class ComplianceApi {
  ComplianceApi(this.client);
  final SanthaApiClient client;
  Dio get _dio => client.dio;

  List<T> _items<T>(Response<Json> r, T Function(Json) f) => (r.data!['items'] as List).map((x) => f(x as Json)).toList();

  Future<List<Consent>> consents() => _call(() async => _items(await _dio.get<Json>('/v1/me/consents'), Consent.fromJson));

  Future<List<Consent>> setConsent(String purpose, bool granted) =>
      _call(() async => _items(await _dio.put<Json>('/v1/me/consents', data: {'purpose': purpose, 'granted': granted}), Consent.fromJson));

  /// access (export ready at once) | correction | erasure. 409 ALREADY_EXISTS while one is open.
  Future<DataRequest> requestData(String type, {String? details}) =>
      _call(() async => DataRequest.fromJson((await _dio.post<Json>('/v1/me/data-requests', data: {'type': type, 'details': ?details})).data!));

  /// The JSON export of an access request (everything Santha holds about you).
  Future<Json> exportData(String requestId) => _call(() async {
        final r = await _dio.get<String>('/v1/me/data-requests/$requestId/export', options: Options(responseType: ResponseType.plain));
        return jsonDecode(r.data!) as Json;
      });

  Future<List<DataRequest>> dataRequests() => _call(() async => _items(await _dio.get<Json>('/v1/me/data-requests'), DataRequest.fromJson));

  Future<Grievance> raiseGrievance(String category, String description, {String? orderId}) => _call(() async =>
      Grievance.fromJson((await _dio.post<Json>('/v1/me/grievances', data: {'category': category, 'description': description, 'orderId': ?orderId})).data!));

  Future<List<Grievance>> grievances() => _call(() async => _items(await _dio.get<Json>('/v1/me/grievances'), Grievance.fromJson));

  /// Merchant app: published reviews and replies.
  Future<List<StoreReview>> storeReviews() async => (await merchantReviews()).items;

  /// Merchant app: the store's rating summary (1–5 breakdown) and its published reviews.
  Future<({RatingSummary summary, List<StoreReview> items})> merchantReviews() => _call(() async {
        final r = await _dio.get<Json>('/v1/merchants/me/reviews');
        final s = r.data!['summary'] as Json?;
        return (summary: s == null ? RatingSummary.empty : RatingSummary.fromJson(s), items: _items(r, StoreReview.fromJson));
      });

  Future<StoreReview> replyToReview(String orderId, String text) =>
      _call(() async => StoreReview.fromJson((await _dio.post<Json>('/v1/merchants/me/reviews/$orderId/reply', data: {'text': text})).data!));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
