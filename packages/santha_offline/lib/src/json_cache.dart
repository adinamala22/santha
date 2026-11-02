import 'dart:convert';
import 'dart:io';

/// A cached value and how old it is.
class Cached<T> {
  const Cached(this.value, this.savedAt, {required this.fresh});
  final T value;
  final DateTime savedAt;

  /// Younger than the cache's freshness window. Stale values are still shown, with an indicator.
  final bool fresh;
}

/// Where cache entries live: files on the device, memory in tests.
abstract interface class CacheStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// One file per key under [dir], LRU-bounded to [maxEntries]. Writes are atomic (temp file +
/// rename) so a crash never leaves half a page behind.
class FileCacheStorage implements CacheStorage {
  FileCacheStorage(this.dir, {this.maxEntries = 200});
  final Directory dir;
  final int maxEntries;

  File _file(String key) => File('${dir.path}${Platform.pathSeparator}${key.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_')}.json');

  @override
  Future<String?> read(String key) async {
    final f = _file(key);
    return await f.exists() ? f.readAsString() : null;
  }

  @override
  Future<void> write(String key, String value) async {
    await dir.create(recursive: true);
    final f = _file(key);
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(value, flush: true);
    await tmp.rename(f.path);
    await _evict();
  }

  @override
  Future<void> delete(String key) async {
    final f = _file(key);
    if (await f.exists()) await f.delete();
  }

  Future<void> _evict() async {
    final files = await dir.list().where((e) => e is File && e.path.endsWith('.json')).cast<File>().toList();
    if (files.length <= maxEntries) return;
    final stats = await Future.wait(files.map((f) async => (f, await f.lastModified())));
    stats.sort((a, b) => a.$2.compareTo(b.$2));
    for (final (f, _) in stats.take(files.length - maxEntries)) {
      await f.delete();
    }
  }
}

class MemoryCacheStorage implements CacheStorage {
  final Map<String, String> values = {};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// JSON cache of API responses with a freshness window. Network first; when the network fails
/// the last saved copy is served, marked not fresh, so the UI can show a stale indicator.
class JsonCache {
  JsonCache(this.storage, {this.freshFor = const Duration(minutes: 15), DateTime Function()? clock}) : _now = clock ?? DateTime.now;

  final CacheStorage storage;
  final Duration freshFor;
  final DateTime Function() _now;

  Future<void> put(String key, Object? json) =>
      storage.write(key, jsonEncode({'savedAt': _now().toUtc().toIso8601String(), 'value': json}));

  /// The cached JSON for [key], or null when there is none (or it cannot be read).
  Future<Cached<Object?>?> get(String key) async {
    final raw = await storage.read(key);
    if (raw == null) return null;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      final savedAt = DateTime.parse(j['savedAt'] as String);
      return Cached(j['value'], savedAt, fresh: _now().difference(savedAt) < freshFor);
    } on FormatException {
      await storage.delete(key);
      return null;
    }
  }

  Future<void> remove(String key) => storage.delete(key);

  /// Network first; on failure fall back to the cache. Rethrows when there is nothing cached.
  Future<Cached<T>> fetch<T>(String key, Future<Object?> Function() network, T Function(Object? json) parse) async {
    try {
      final json = await network();
      final value = parse(json);
      await put(key, json);
      return Cached(value, _now(), fresh: true);
    } catch (_) {
      final hit = await get(key);
      if (hit == null) rethrow;
      return Cached(parse(hit.value), hit.savedAt, fresh: false);
    }
  }
}
