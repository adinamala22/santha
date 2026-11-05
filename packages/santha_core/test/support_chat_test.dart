import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';

/// In-memory support API: one store of threads, like the backend (ADR-028).
class _Support implements HttpClientAdapter {
  final threads = <Map<String, dynamic>>[];
  final calls = <String>[];
  int openCount = 0;
  bool tooMany = false;

  Map<String, dynamic> _list(Map<String, dynamic> t) => {...t}..remove('messages');
  String _now() => DateTime.utc(2026, 11, 5, 10, threads.length).toIso8601String();

  void supportReplies(String id, String body) {
    final t = threads.firstWhere((x) => x['id'] == id);
    (t['messages'] as List).add({'id': 'm${(t['messages'] as List).length}', 'author': 'support', 'body': body, 'createdAt': _now()});
    t['status'] = 'waiting_customer';
    t['unreadByUser'] = (t['unreadByUser'] as int) + 1;
    t['lastMessagePreview'] = body;
  }

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async {
    calls.add('${o.method} ${o.path}');
    final path = o.path;
    final (int status, Object body) = switch (o.method) {
      'GET' when path == '/v1/support/threads' => (200, {'items': threads.map(_list).toList()}),
      'POST' when path == '/v1/support/threads' && tooMany => (429, {'error': {'code': 'RATE_LIMITED', 'message': 'x', 'details': {'openThreads': 3}}}),
      'POST' when path == '/v1/support/threads' => (() {
          final b = o.data as Map;
          final t = <String, dynamic>{
            'id': 't${++openCount}',
            'app': 'consumer',
            'orderId': b['orderId'],
            'orderCode': b['orderId'] == null ? null : 'SN4821',
            'topic': b['topic'],
            'status': 'waiting_support',
            'lastMessageAt': _now(),
            'lastMessagePreview': b['body'],
            'unreadByUser': 0,
            'resolvedAt': null,
            'createdAt': _now(),
            'messages': [
              {'id': 'm0', 'author': 'user', 'body': b['body'], 'createdAt': _now()},
            ],
          };
          threads.insert(0, t);
          return (201, t);
        })(),
      'GET' => (() {
          final t = threads.firstWhere((x) => path.endsWith('/${x['id']}'));
          t['unreadByUser'] = 0;
          return (200, t);
        })(),
      'POST' when path.endsWith('/messages') => (() {
          final t = threads.firstWhere((x) => path.contains('/${x['id']}/'));
          (t['messages'] as List).add({'id': 'm${(t['messages'] as List).length}', 'author': 'user', 'body': (o.data as Map)['body'], 'createdAt': _now()});
          t['status'] = 'waiting_support';
          return (201, t);
        })(),
      _ => (404, {'error': {'code': 'NOT_FOUND', 'message': 'x'}}),
    };
    return ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

final _strings = SupportStrings(
  title: 'Help & support',
  intro: 'Chat with the Santha team.',
  newChat: 'New chat',
  empty: 'No chats yet.',
  topicTitle: 'What do you need help with?',
  messageHint: 'Write your message',
  send: 'Send',
  start: 'Start chat',
  support: 'Santha support',
  waitingSupport: 'Waiting for support',
  waitingCustomer: 'Support replied',
  resolved: 'Resolved',
  resolvedNote: 'This chat is resolved.',
  orderLabel: (c) => 'Order #$c',
  topicLabel: (t) => {'order_late': 'Order is late', 'payment': 'Payment'}[t] ?? t,
  tooManyOpen: 'You already have 3 open chats.',
  slowDown: 'Please wait.',
  closed: 'Closed.',
  errorNetwork: 'No connection',
  errorGeneric: 'Something went wrong',
  loading: 'Loading',
  retry: 'Try again',
);

void main() {
  late _Support api;
  late FakeRealtime realtime;

  Future<ProviderContainer> pump(WidgetTester tester, Widget Function() home) async {
    api = _Support();
    realtime = FakeRealtime();
    final container = ProviderContainer(overrides: [
      appConfigProvider.overrideWithValue(const AppConfig(flavor: Flavor.dev, app: SanthaApp.consumer, apiBaseUrl: 'http://api.test')),
      keyValueStoreProvider.overrideWithValue(MemoryKeyValueStore()),
      deviceIdProvider.overrideWithValue('device-test-1'),
      realtimeEventsProvider.overrideWith((ref) => realtime.events),
      supportPollEveryProvider.overrideWithValue(null),
      apiClientProvider.overrideWith((ref) => SanthaApiClient(baseUrl: 'http://api.test', deviceId: 'device-test-1', tokens: ref.watch(tokenStoreProvider), dio: Dio()..httpClientAdapter = api)),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: MaterialApp(home: Builder(builder: (_) => home()))));
    await tester.pumpAndSettle();
    return container;
  }

  testWidgets('new chat: pick a topic, write, see it; a support reply arrives live; answer it', (tester) async {
    await pump(tester, () => SupportInboxPage(strings: _strings, topics: const ['order_late', 'payment']));
    expect(find.byKey(const ValueKey('support-empty')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('support-new')));
    await tester.pumpAndSettle();
    expect(tester.widget<SanthaButtonLike>(find.byKey(const ValueKey('support-start'))).enabled, isFalse);
    await tester.tap(find.byKey(const ValueKey('support-topic-payment')));
    await tester.enterText(find.byKey(const ValueKey('support-first-message')), 'Charged twice for one order');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('support-start')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('POST /v1/support/threads'));
    expect(find.text('Charged twice for one order'), findsOneWidget);
    expect(find.text('Payment'), findsOneWidget); // the chat's title

    api.supportReplies('t1', 'We are checking with the bank.');
    realtime.emit('support.message', {'threadId': 't1'});
    await tester.pumpAndSettle();
    expect(find.text('We are checking with the bank.'), findsOneWidget);
    expect(find.text('Santha support'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('support-input')), 'Thanks');
    await tester.tap(find.byKey(const ValueKey('support-send')));
    await tester.pumpAndSettle();
    expect(find.text('Thanks'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const ValueKey('support-input'))).controller!.text, isEmpty);
  });

  testWidgets('the inbox shows unread replies; about an order, the order is named; too many open chats explains', (tester) async {
    final container = await pump(tester, () => Builder(
          builder: (context) => Consumer(
            builder: (context, ref, _) => Scaffold(
              body: Column(children: [
                TextButton(onPressed: () => startSupportChat(context, ref, strings: _strings, topics: const ['order_late'], orderId: 'o1', orderCode: 'SN4821', initialTopic: 'order_late'), child: const Text('help')),
                TextButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SupportInboxPage(strings: _strings, topics: const ['order_late']))), child: const Text('inbox')),
              ]),
            ),
          ),
        ));
    await tester.tap(find.text('help'));
    await tester.pumpAndSettle();
    expect(find.text('Order #SN4821'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('support-first-message')), 'Where is it?');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('support-start'))); // topic preselected
    await tester.pumpAndSettle();
    expect(find.text('Order is late · Order #SN4821'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    api.supportReplies('t1', 'On its way');
    container.invalidate(supportThreadsProvider);
    await tester.tap(find.text('inbox'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('support-unread-t1')), findsOneWidget);
    expect(container.read(supportUnreadProvider), 1);
    await tester.pageBack();
    await tester.pumpAndSettle();

    api.tooMany = true;
    await tester.tap(find.text('help'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('support-first-message')), 'Another one');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('support-start')));
    await tester.pumpAndSettle();
    expect(find.text('You already have 3 open chats.'), findsOneWidget);
  });
}

/// SanthaButton exposes onPressed; read "enabled" through it.
extension type SanthaButtonLike(Widget w) implements Widget {
  bool get enabled => (w as dynamic).onPressed != null;
}
