import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';

import '../config/app_config.dart';
import '../storage/key_value_store.dart';
import '../push/push.dart';
import 'session_storage.dart';

sealed class AuthState {
  const AuthState();
}

/// Restoring the session at start-up.
final class AuthUnknown extends AuthState {
  const AuthUnknown();
}

final class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.sessionExpired = false});

  /// True when the server ended the session (show a gentle "please sign in again").
  final bool sessionExpired;
}

final class AuthSignedIn extends AuthState {
  const AuthSignedIn(this.me);
  final Me me;
}

/// Overridden in bootstrap with [SecureKeyValueStore] (tests: [MemoryKeyValueStore]).
final keyValueStoreProvider = Provider<KeyValueStore>((ref) => throw UnimplementedError('override keyValueStoreProvider'));

/// Overridden in bootstrap after [loadOrCreateDeviceId].
final deviceIdProvider = Provider<String>((ref) => throw UnimplementedError('override deviceIdProvider'));

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore(ref.watch(keyValueStoreProvider)));

final apiClientProvider = Provider<SanthaApiClient>((ref) {
  final config = ref.watch(appConfigProvider);
  return SanthaApiClient(
    baseUrl: config.apiBaseUrl,
    deviceId: ref.watch(deviceIdProvider),
    tokens: ref.watch(tokenStoreProvider),
    appVersion: config.appVersion,
    onSessionExpired: () => ref.read(authControllerProvider.notifier).sessionExpired(),
  );
});

final authApiProvider = Provider<AuthApi>((ref) {
  final config = ref.watch(appConfigProvider);
  return AuthApi(ref.watch(apiClientProvider), app: config.app, platform: currentClientPlatform());
});

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    unawaited(Future.microtask(_restore));
    return const AuthUnknown();
  }

  AuthApi get _api => ref.read(authApiProvider);
  KeyValueStore get _kv => ref.read(keyValueStoreProvider);

  Future<void> _restore() async {
    final tokens = await ref.read(tokenStoreProvider).read();
    if (tokens == null) {
      state = const AuthSignedOut();
      return;
    }
    // Show the cached profile immediately (works offline), then refresh it from the server.
    final cached = await _kv.read(SessionKeys.me);
    if (cached != null) state = AuthSignedIn(Me.fromJson(jsonDecode(cached) as Map<String, dynamic>));
    try {
      await _signedIn(await _api.me());
    } on ApiException catch (e) {
      if (e.code == ApiException.network && state is AuthSignedIn) return;
      if (state is! AuthSignedOut) state = const AuthSignedOut();
    }
  }

  Future<OtpChallenge> requestOtp({required String phone, required String locale}) =>
      _api.requestOtp(phone: phone, locale: locale);

  Future<void> verifyOtp({required String challengeId, required String code}) async {
    final session = await _api.verifyOtp(
      challengeId: challengeId,
      code: code,
      appVersion: ref.read(appConfigProvider).appVersion,
    );
    await _signedIn(session.user);
  }

  Future<void> signOut() async {
    await ref.read(pushRegistrationProvider).unregister(); // while still signed in (needs the session)
    await _api.logout();
    state = const AuthSignedOut();
  }

  /// Called by the API client when refresh fails (tokens already cleared).
  void sessionExpired() {
    state = const AuthSignedOut(sessionExpired: true);
  }

  Future<void> _signedIn(Me me) async {
    await _kv.write(SessionKeys.me, jsonEncode(me.toJson()));
    state = AuthSignedIn(me);
  }
}
