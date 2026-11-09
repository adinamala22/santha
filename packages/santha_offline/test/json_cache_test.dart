import 'dart:io';

import 'package:santha_offline/santha_offline.dart';
import 'package:test/test.dart';

void main() {
  late Directory dir;
  var now = DateTime.utc(2026, 11, 2, 10);
  setUp(() async => dir = await Directory.systemTemp.createTemp('santha_cache'));
  tearDown(() => dir.delete(recursive: true));

  JsonCache cache({int max = 200}) => JsonCache(FileCacheStorage(dir, maxEntries: max), clock: () => now);

  test('stores JSON and reports freshness', () async {
    final c = cache();
    await c.put('store:1', {'name': 'Ramesh Stores'});
    expect((await c.get('store:1'))!.fresh, isTrue);
    now = now.add(const Duration(minutes: 16));
    final hit = await c.get('store:1');
    expect(hit!.fresh, isFalse);
    expect((hit.value as Map)['name'], 'Ramesh Stores');
  });

  test('fetch: network first, cache on failure, rethrow when empty', () async {
    final c = cache();
    final first = await c.fetch('feed', () async => {'n': 1}, (j) => (j as Map)['n'] as int);
    expect((first.value, first.fresh), (1, true));
    final offline = await c.fetch<int>('feed', () async => throw const SocketException('offline'), (j) => (j as Map)['n'] as int);
    expect((offline.value, offline.fresh), (1, false));
    expect(() => c.fetch<int>('other', () async => throw const SocketException('offline'), (j) => 0), throwsA(isA<SocketException>()));
  });

  test('clear removes every entry (sign-out), on disk and in memory', () async {
    final c = cache();
    await c.put('rider_home', {'a': 1});
    await c.put('job_x', {'b': 2});
    await c.clear();
    expect(await c.get('rider_home'), isNull);
    expect(await c.get('job_x'), isNull);
    expect(dir.listSync(), isEmpty);
    await c.put('again', {'c': 3}); // still usable afterwards
    expect((await c.get('again'))!.value, {'c': 3});

    final mem = JsonCache(MemoryCacheStorage());
    await mem.put('k', 1);
    await mem.clear();
    expect(await mem.get('k'), isNull);
    // clearing a cache that never wrote anything is fine
    await JsonCache(FileCacheStorage(Directory('${dir.path}/never-created'))).clear();
  });

  test('keys are file-safe and the cache stays bounded', () async {
    final c = cache(max: 3);
    for (var i = 0; i < 5; i++) {
      await c.put('store:$i?lat=14.4&lng=79.9', i);
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(dir.listSync().length, 3);
    expect(await c.get('store:0?lat=14.4&lng=79.9'), isNull);
    expect((await c.get('store:4?lat=14.4&lng=79.9'))!.value, 4);
  });
}
