import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_controller.dart';
import 'auth/session_storage.dart';
import 'config/app_config.dart';
import 'push/push.dart';
import 'storage/key_value_store.dart';

/// Shared `main()` body for every app/flavor: loads the device id, wires providers, runs [app].
Future<void> bootstrap(AppConfig config, Widget app, {KeyValueStore? store}) async {
  WidgetsFlutterBinding.ensureInitialized();
  final kv = store ?? SecureKeyValueStore();
  final deviceId = await loadOrCreateDeviceId(kv);
  // Push (FCM) when this build has Firebase settings; otherwise the app runs without it.
  final push = await FirebasePush.start(FirebaseSettings.fromEnvironment());
  runApp(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(config),
        keyValueStoreProvider.overrideWithValue(kv),
        deviceIdProvider.overrideWithValue(deviceId),
        if (push != null) pushMessagingProvider.overrideWithValue(push),
      ],
      child: app,
    ),
  );
}
