import 'dart:convert';

import 'package:santha_api/santha_api.dart';
import 'package:uuid/uuid.dart';

import '../storage/key_value_store.dart';

abstract final class SessionKeys {
  static const deviceId = 'santha.device_id';
  static const tokens = 'santha.tokens';
  static const me = 'santha.me';
}

/// Random per-install id. Survives app restarts; a reinstall gets a new id (and must sign in again).
Future<String> loadOrCreateDeviceId(KeyValueStore store) async {
  final existing = await store.read(SessionKeys.deviceId);
  if (existing != null && existing.isNotEmpty) return existing;
  final id = const Uuid().v4();
  await store.write(SessionKeys.deviceId, id);
  return id;
}

/// [TokenStore] backed by secure storage.
class SecureTokenStore implements TokenStore {
  SecureTokenStore(this.store);

  final KeyValueStore store;
  TokenPair? _cache;

  @override
  Future<TokenPair?> read() async {
    if (_cache != null) return _cache;
    final raw = await store.read(SessionKeys.tokens);
    if (raw == null) return null;
    return _cache = TokenPair.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  @override
  Future<void> write(TokenPair tokens) async {
    _cache = tokens;
    await store.write(
      SessionKeys.tokens,
      jsonEncode({
        'accessToken': tokens.accessToken,
        'refreshToken': tokens.refreshToken,
        'accessExpiresIn': tokens.accessExpiresIn,
        'refreshExpiresIn': tokens.refreshExpiresIn,
      }),
    );
  }

  @override
  Future<void> clear() async {
    _cache = null;
    await store.delete(SessionKeys.tokens);
    await store.delete(SessionKeys.me);
  }
}
