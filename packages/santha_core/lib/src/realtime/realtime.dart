import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;

import '../auth/auth_controller.dart';
import '../config/app_config.dart';

/// One realtime message from the backend gateway (Socket.IO at /v1/realtime).
class RealtimeEvent {
  const RealtimeEvent(this.name, this.data);
  /// order.new (merchant), order.updated, store.paused.
  final String name;
  final Map<String, dynamic> data;
  String? get orderId => data['orderId'] as String?;
}

/// Realtime connection with the signed-in user's access token. Screens listen to [events] and
/// refresh; they must also poll as a fallback (sockets drop on poor networks), so this is an
/// accelerator, never the only path. Tests override [realtimeProvider] with a [FakeRealtime].
abstract class Realtime {
  Stream<RealtimeEvent> get events;
  bool get connected;
  Future<void> connect();
  void dispose();
}

class SocketRealtime implements Realtime {
  SocketRealtime(this._baseUrl, this._token, this._deviceId);

  final String _baseUrl;
  final Future<String?> Function() _token;
  final String _deviceId;
  final _events = StreamController<RealtimeEvent>.broadcast();
  sio.Socket? _socket;
  bool _connected = false;

  @override
  Stream<RealtimeEvent> get events => _events.stream;

  @override
  bool get connected => _connected;

  @override
  Future<void> connect() async {
    if (_socket != null) return;
    final token = await _token();
    if (token == null) return;
    final s = sio.io(
      _baseUrl,
      sio.OptionBuilder().setPath('/v1/realtime').setTransports(['websocket']).setAuth({'token': token, 'deviceId': _deviceId}).enableReconnection().build(),
    );
    s.on('ready', (_) => _connected = true);
    s.onDisconnect((_) => _connected = false);
    // An expired token: drop this socket; the next connect() uses the refreshed one.
    s.on('error', (_) {
      _connected = false;
      s.dispose();
      if (identical(_socket, s)) _socket = null;
    });
    for (final name in const ['order.new', 'order.updated', 'store.paused']) {
      s.on(name, (data) {
        if (data is Map) _events.add(RealtimeEvent(name, Map<String, dynamic>.from(data)));
      });
    }
    _socket = s;
  }

  @override
  void dispose() {
    _socket?.dispose();
    _socket = null;
    _events.close();
  }
}

/// In-process stand-in for tests: push events with [emit].
class FakeRealtime implements Realtime {
  final _events = StreamController<RealtimeEvent>.broadcast();
  @override
  Stream<RealtimeEvent> get events => _events.stream;
  @override
  bool get connected => true;
  @override
  Future<void> connect() async {}
  void emit(String name, Map<String, dynamic> data) => _events.add(RealtimeEvent(name, data));
  @override
  void dispose() => _events.close();
}

final realtimeProvider = Provider<Realtime>((ref) {
  final config = ref.watch(appConfigProvider);
  final tokens = ref.watch(tokenStoreProvider);
  final r = SocketRealtime(config.apiBaseUrl, () async => (await tokens.read())?.accessToken, ref.watch(deviceIdProvider));
  ref.onDispose(r.dispose);
  if (kDebugMode) debugPrint('[realtime] ${config.apiBaseUrl}/v1/realtime');
  return r;
});

/// Realtime events while signed in (connects lazily).
final realtimeEventsProvider = StreamProvider<RealtimeEvent>((ref) {
  final auth = ref.watch(authControllerProvider);
  if (auth is! AuthSignedIn) return const Stream.empty();
  final r = ref.watch(realtimeProvider);
  r.connect();
  return r.events;
});
