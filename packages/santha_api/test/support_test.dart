import 'dart:convert';
import 'dart:io';

import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// Support chat (ADR-028): the thread model parses the API's shape.
void main() {
  test('a chat with a support reply waiting to be read', () {
    final t = SupportThread.fromJson(fixture('support_thread'));
    expect(t.status, SupportStatus.waitingCustomer);
    expect(t.unread, 1);
    expect(t.orderCode, 'SNAWHNNF');
    expect(t.messages.map((m) => m.fromSupport), [false, true]);
    expect(t.messages.last.createdAt, DateTime.utc(2026, 11, 5, 10, 12));
    expect(SupportStatus.parse('resolved'), SupportStatus.resolved);
  });

  test('a chat list item has no messages', () {
    final j = fixture('support_thread')..remove('messages');
    expect(SupportThread.fromJson(j).messages, isEmpty);
  });
}
