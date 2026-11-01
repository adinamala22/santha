import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:santha_ui/santha_ui.dart';

/// Loads the bundled fonts under the family names the theme resolves to
/// (`packages/santha_ui/<Family>`), so goldens show real Poppins / Noto Sans Telugu, not Ahem.
Future<void> loadSanthaFonts() async {
  Future<ByteData> bytes(String path) async => ByteData.view(Uint8List.fromList(await File(path).readAsBytes()).buffer);

  final poppins = FontLoader('packages/santha_ui/Poppins');
  for (final w in ['Regular', 'Medium', 'Bold']) {
    poppins.addFont(bytes('fonts/Poppins-$w.ttf'));
  }
  final telugu = FontLoader('packages/santha_ui/NotoSansTelugu')..addFont(bytes('fonts/NotoSansTelugu.ttf'));
  final loads = [poppins.load(), telugu.load()];

  // Material Icons ship with the Flutter SDK; without them icons render as boxes in goldens.
  final flutterRoot = Platform.environment['FLUTTER_ROOT'];
  final icons = File('$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (flutterRoot != null && icons.existsSync()) {
    loads.add((FontLoader('MaterialIcons')..addFont(bytes(icons.path))).load());
  }
  await Future.wait(loads);
}

/// Pumps [child] inside the Santha theme on a fixed-size white canvas.
Future<void> pumpThemed(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(360, 240),
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: santhaTheme(locale: locale),
      home: Scaffold(
        body: RepaintBoundary(
          key: const ValueKey('golden'),
          child: Padding(padding: const EdgeInsets.all(SanthaSpacing.s4), child: child),
        ),
      ),
    ),
  );
}
