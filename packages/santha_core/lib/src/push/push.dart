import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';

import '../analytics/analytics.dart';
import '../auth/auth_controller.dart';
import '../config/app_config.dart';

/// A notification the person tapped (its FCM data, strings only): `kind` (new_order, order, offer,
/// store_paused…) and ids such as `orderId`.
@immutable
class PushTap {
  const PushTap(this.data);
  final Map<String, String> data;
  String? get kind => data['kind'];
  String? get orderId => data['orderId'];
  /// Set on support replies (kind `support`, ADR-028).
  String? get threadId => data['threadId'];
}

/// Push messaging on this phone. [NoPush] when Firebase is not configured (local dev, tests).
abstract interface class PushMessaging {
  /// Asks for permission to show notifications (Android 13+, iOS). True when allowed.
  Future<bool> requestPermission();

  /// The FCM token, or null when there is none (no Play services, not allowed).
  Future<String?> token();
  Stream<String> get onTokenRefresh;

  /// Notification taps while the app runs in the background.
  Stream<PushTap> get onTap;

  /// The tap that opened the app from closed, if any.
  Future<PushTap?> initialTap();
}

class NoPush implements PushMessaging {
  const NoPush();
  @override
  Future<bool> requestPermission() async => false;
  @override
  Future<String?> token() async => null;
  @override
  Stream<String> get onTokenRefresh => const Stream.empty();
  @override
  Stream<PushTap> get onTap => const Stream.empty();
  @override
  Future<PushTap?> initialTap() async => null;
}

/// Firebase settings come from the build (`--dart-define=FIREBASE_…`, set per app by apps-release.yml from
/// the values file), so no google-services.json is committed. Missing → push is off.
class FirebaseSettings {
  const FirebaseSettings({required this.apiKey, required this.appId, required this.senderId, required this.projectId});

  factory FirebaseSettings.fromEnvironment() => const FirebaseSettings(
        apiKey: String.fromEnvironment('FIREBASE_API_KEY'),
        appId: String.fromEnvironment('FIREBASE_APP_ID'),
        senderId: String.fromEnvironment('FIREBASE_SENDER_ID'),
        projectId: String.fromEnvironment('FIREBASE_PROJECT_ID'),
      );

  final String apiKey;
  final String appId;
  final String senderId;
  final String projectId;

  bool get configured => apiKey.isNotEmpty && appId.isNotEmpty && senderId.isNotEmpty && projectId.isNotEmpty;
  FirebaseOptions get options => FirebaseOptions(apiKey: apiKey, appId: appId, messagingSenderId: senderId, projectId: projectId);
}

class FirebasePush implements PushMessaging {
  FirebasePush._();

  /// Starts Firebase with [settings]; null when it is not configured or cannot start (no Play services).
  static Future<FirebasePush?> start(FirebaseSettings settings) async {
    if (!settings.configured || kIsWeb) return null;
    try {
      await Firebase.initializeApp(options: settings.options);
      return FirebasePush._();
    } catch (e) {
      debugPrint('push: Firebase did not start ($e)');
      return null;
    }
  }

  FirebaseMessaging get _m => FirebaseMessaging.instance;

  @override
  Future<bool> requestPermission() async {
    final s = await _m.requestPermission();
    return s.authorizationStatus == AuthorizationStatus.authorized || s.authorizationStatus == AuthorizationStatus.provisional;
  }

  // The backend sends with FCM HTTP v1 to registration tokens (`message.token`), which getToken / onTokenRefresh
  // return. firebase_messaging 17 deprecates them for installation-ID sends; move both sides together later.
  @override
  // ignore: deprecated_member_use
  Future<String?> token() => _m.getToken();

  @override
  // ignore: deprecated_member_use
  Stream<String> get onTokenRefresh => _m.onTokenRefresh;

  @override
  Stream<PushTap> get onTap => FirebaseMessaging.onMessageOpenedApp.map((m) => PushTap(_strings(m.data)));

  @override
  Future<PushTap?> initialTap() async {
    final m = await _m.getInitialMessage();
    return m == null ? null : PushTap(_strings(m.data));
  }

  static Map<String, String> _strings(Map<String, dynamic> d) => {for (final e in d.entries) e.key: '${e.value}'};
}

/// Overridden in [bootstrap] when Firebase starts.
final pushMessagingProvider = Provider<PushMessaging>((ref) => const NoPush());

final pushApiProvider = Provider<PushApi>((ref) => PushApi(ref.watch(apiClientProvider)));

/// This phone's push registration. [PushRegistration.unregister] runs before sign-out (AuthController.signOut),
/// so a shared phone stops getting the previous person's notifications. It does not depend on the auth state
/// (that would be a cycle); [pushSyncProvider] feeds it the auth changes.
final pushRegistrationProvider = Provider<PushRegistration>((ref) {
  final r = PushRegistration(ref);
  ref.onDispose(r.dispose);
  return r;
});

/// Keeps the token on the server while someone is signed in: registers after sign-in and whenever FCM rotates
/// it. Each app watches this provider (app.dart).
final pushSyncProvider = Provider<void>((ref) {
  final r = ref.watch(pushRegistrationProvider);
  ref.listen<AuthState>(authControllerProvider, (_, next) => r.onAuth(next), fireImmediately: true);
});

class PushRegistration {
  PushRegistration(this._ref);
  final Ref _ref;
  StreamSubscription<String>? _refresh;
  bool _registered = false;

  bool get registered => _registered;

  void onAuth(AuthState s) {
    if (s is AuthSignedIn) {
      unawaited(_register());
    } else if (s is AuthSignedOut) {
      _refresh?.cancel();
      _refresh = null;
      _registered = false;
    }
  }

  Future<void> _register() async {
    final push = _ref.read(pushMessagingProvider);
    try {
      await push.requestPermission();
      final token = await push.token();
      if (token != null) await _send(token);
      _refresh ??= push.onTokenRefresh.listen((t) => unawaited(_send(t)));
    } catch (e) {
      debugPrint('push: registration failed ($e)'); // tried again at the next sign-in or token refresh
    }
  }

  Future<void> _send(String token) async {
    await _ref.read(pushApiProvider).register(token, currentClientPlatform().name);
    _registered = true;
    _ref.read(analyticsProvider).track('push_registered', {'platform': currentClientPlatform().name});
  }

  /// Before sign-out: this phone stops getting the person's notifications. Never blocks sign-out.
  Future<void> unregister() async {
    if (!_registered) return;
    try {
      await _ref.read(pushApiProvider).unregister();
    } catch (_) {}
    _registered = false;
  }

  void dispose() => _refresh?.cancel();
}

/// Notification taps: the one that opened the app (once), then taps while it runs. Apps route on [PushTap.kind].
final pushTapsProvider = StreamProvider<PushTap>((ref) async* {
  final push = ref.watch(pushMessagingProvider);
  final first = await push.initialTap();
  if (first != null) yield first;
  yield* push.onTap;
});
