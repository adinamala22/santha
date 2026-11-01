import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// lib/src/tokens.dart must be a verbatim copy of design/tokens/santha_tokens.dart.
/// To update: edit design/tokens (tokens.json first), then copy the Dart file over.
void main() {
  test('tokens.dart matches design/tokens/santha_tokens.dart', () {
    final source = File('../../design/tokens/santha_tokens.dart').readAsStringSync().replaceAll('\r\n', '\n');
    final copy = File('lib/src/tokens.dart').readAsStringSync().replaceAll('\r\n', '\n');
    expect(copy, source, reason: 'Run: cp design/tokens/santha_tokens.dart packages/santha_ui/lib/src/tokens.dart');
  });
}
