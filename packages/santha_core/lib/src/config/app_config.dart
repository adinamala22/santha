import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';

enum Flavor { dev, stg, prod }

/// Per-flavor runtime configuration, created in `main_<flavor>.dart`.
@immutable
class AppConfig {
  const AppConfig({required this.flavor, required this.app, required this.apiBaseUrl, this.appVersion = '0.1.0'});

  /// Default API host per flavor. Dev targets the local backend; the Android emulator reaches the
  /// host machine at 10.0.2.2. Override with `--dart-define=API_BASE_URL=http://192.168.x.x:4000`
  /// when running on a physical device.
  factory AppConfig.forFlavor(Flavor flavor, SanthaApp app) => AppConfig(
        flavor: flavor,
        app: app,
        apiBaseUrl: switch (flavor) {
          Flavor.dev => const String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000'),
          Flavor.stg => const String.fromEnvironment('API_BASE_URL', defaultValue: 'https://api.test.santha.app'),
          // Release builds get the real address from CI (--dart-define=API_BASE_URL=…, see apps-release.yml).
          Flavor.prod => const String.fromEnvironment('API_BASE_URL', defaultValue: 'https://api.santha.app'),
        },
      );

  final Flavor flavor;
  final SanthaApp app;
  final String apiBaseUrl;
  final String appVersion;

  bool get isProd => flavor == Flavor.prod;
}

/// Overridden in `main_<flavor>.dart` via `ProviderScope(overrides: [...])`.
final appConfigProvider = Provider<AppConfig>((ref) => throw UnimplementedError('appConfigProvider must be overridden'));

ClientPlatform currentClientPlatform() {
  if (kIsWeb) return ClientPlatform.web;
  return defaultTargetPlatform == TargetPlatform.iOS ? ClientPlatform.ios : ClientPlatform.android;
}
