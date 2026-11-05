import 'package:dio/dio.dart';

import 'api_client.dart';
import 'api_exception.dart';
import 'models.dart';

/// Support chat (ADR-028): waiting for support, waiting for the customer, or resolved.
enum SupportStatus {
  waitingSupport('waiting_support'),
  waitingCustomer('waiting_customer'),
  resolved('resolved');

  const SupportStatus(this.wire);
  final String wire;
  static SupportStatus parse(String s) => values.firstWhere((v) => v.wire == s, orElse: () => waitingSupport);
}

class SupportMessage {
  const SupportMessage({required this.id, required this.fromSupport, required this.body, required this.createdAt});
  factory SupportMessage.fromJson(Json j) => SupportMessage(
        id: j['id'] as String,
        fromSupport: j['author'] == 'support',
        body: j['body'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final String id;
  final bool fromSupport;
  final String body;
  final DateTime createdAt;
}

class SupportThread {
  const SupportThread({
    required this.id,
    required this.topic,
    required this.status,
    required this.lastMessageAt,
    required this.lastMessagePreview,
    required this.unread,
    this.orderId,
    this.orderCode,
    this.messages = const [],
  });
  factory SupportThread.fromJson(Json j) => SupportThread(
        id: j['id'] as String,
        topic: j['topic'] as String,
        status: SupportStatus.parse(j['status'] as String),
        lastMessageAt: DateTime.parse(j['lastMessageAt'] as String),
        lastMessagePreview: j['lastMessagePreview'] as String,
        unread: j['unreadByUser'] as int,
        orderId: j['orderId'] as String?,
        orderCode: j['orderCode'] as String?,
        messages: ((j['messages'] as List?) ?? const []).map((m) => SupportMessage.fromJson(m as Json)).toList(),
      );
  final String id;
  final String topic;
  final SupportStatus status;
  final DateTime lastMessageAt;
  final String lastMessagePreview;

  /// Support replies not opened yet.
  final int unread;
  final String? orderId;
  final String? orderCode;
  final List<SupportMessage> messages;
}

class SupportApi {
  SupportApi(SanthaApiClient client) : _dio = client.dio;
  final Dio _dio;

  /// Starts a chat (or adds to the open one about the same order). 429 RATE_LIMITED with 3 open chats.
  Future<SupportThread> open({required String topic, required String body, String? orderId}) =>
      _thread(() => _dio.post<Json>('/v1/support/threads', data: {'topic': topic, 'body': body, 'orderId': ?orderId}));

  Future<List<SupportThread>> threads() => _call(() async => ((await _dio.get<Json>('/v1/support/threads')).data!['items'] as List).map((t) => SupportThread.fromJson(t as Json)).toList());

  /// One chat with its messages; support's replies count as read.
  Future<SupportThread> thread(String id) => _thread(() => _dio.get<Json>('/v1/support/threads/$id'));

  Future<SupportThread> write(String id, String body) => _thread(() => _dio.post<Json>('/v1/support/threads/$id/messages', data: {'body': body}));

  Future<SupportThread> _thread(Future<Response<Json>> Function() req) => _call(() async => SupportThread.fromJson((await req()).data!));

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
