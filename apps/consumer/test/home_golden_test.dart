@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

/// Home vs design/mockups/consumer-home-hifi.png (token colours and layout). Compared on Linux only,
/// like santha_ui's goldens; regenerate with `melos run golden:update` and review against the mockup.
final skipOffLinux = !Platform.isLinux;

Future<void> _loadFonts() async {
  Future<ByteData> bytes(String path) async => ByteData.view(Uint8List.fromList(await File(path).readAsBytes()).buffer);
  const fonts = '../../packages/santha_ui/fonts';
  final poppins = FontLoader('packages/santha_ui/Poppins');
  for (final w in ['Regular', 'Medium', 'Bold']) {
    poppins.addFont(bytes('$fonts/Poppins-$w.ttf'));
  }
  final telugu = FontLoader('packages/santha_ui/NotoSansTelugu')..addFont(bytes('$fonts/NotoSansTelugu.ttf'));
  final loads = [poppins.load(), telugu.load()];
  final root = Platform.environment['FLUTTER_ROOT'];
  final icons = File('$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (root != null && icons.existsSync()) loads.add((FontLoader('MaterialIcons')..addFont(bytes(icons.path))).load());
  await Future.wait(loads);
}

void main() {
  setUpAll(() async {
    WidgetsApp.debugAllowBannerOverride = false; // no DEBUG ribbon in goldens
    await _loadFonts();
  });

  testWidgets('Home (Stores tab, Dargamitta)', (tester) async {
    await pumpAtHome(tester);
    tester.view.physicalSize = const Size(1080, 2340); // 360 × 780 dp phone
    await settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/home.png'));
  }, skip: skipOffLinux);

  testWidgets('Home in Telugu', (tester) async {
    await pumpAtHome(tester, locale: 'te');
    tester.view.physicalSize = const Size(1080, 2340);
    await settle(tester);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/home_te.png'));
  }, skip: skipOffLinux);
}
