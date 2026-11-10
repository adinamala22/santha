import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_offline/santha_offline.dart';

/// Where the deliveries in hand are kept on the phone (ADR-035). Private to the app; emptied at sign-out.
/// Tests override it with a [MemoryCacheStorage].
final riderCacheProvider = FutureProvider<JsonCache>((ref) async {
  final base = await getApplicationSupportDirectory();
  return JsonCache(FileCacheStorage(Directory('${base.path}${Platform.pathSeparator}santha_rider_jobs'), maxEntries: 20));
});

/// When set, the screens are showing the copy saved at this time because the network is down.
final riderOfflineProvider = NotifierProvider<RiderOffline, DateTime?>(RiderOffline.new);

class RiderOffline extends Notifier<DateTime?> {
  @override
  DateTime? build() => null;
  void set(DateTime? since) {
    if (state != since) state = since;
  }
}

const _homeKey = 'rider_home';
const _indexKey = 'job_ids';
String _jobKey(String id) => 'job_$id';

/// The rider API that remembers the deliveries in hand (ADR-035). When the network drops mid-delivery the home and
/// the job screen still open from the last copy, with the time it was saved; only network failures fall back to
/// it (a refusal from the server, such as an expired session or a cancelled job, is shown as it is).
/// Actions (arrived, picked up, delivered) are never queued: they need the network.
class OfflineRiderApi extends RiderApi {
  OfflineRiderApi(super.client, this._cache, this._onState);

  final Future<JsonCache> Function() _cache;
  final void Function(DateTime? since) _onState;

  Future<JsonCache?> _open() async {
    try {
      return await _cache();
    } catch (_) {
      return null; // no storage: work online only
    }
  }

  @override
  Future<RiderHome> home() async {
    final cache = await _open();
    try {
      final json = await homeJson();
      _onState(null);
      if (cache != null) await _remember(cache, json);
      return RiderHome.fromJson(json);
    } on ApiException catch (e) {
      if (e.code != ApiException.network || cache == null) rethrow;
      final hit = await cache.get(_homeKey);
      if (hit == null || hit.value is! Map) rethrow;
      // An offer has expired by now and the rider cannot answer it without the network.
      final json = Map<String, dynamic>.from(hit.value! as Map)..remove('offer');
      _onState(hit.savedAt);
      return RiderHome.fromJson(json);
    }
  }

  @override
  Future<Job> job(String id) async {
    final cache = await _open();
    try {
      final json = await jobJson(id);
      _onState(null);
      final job = Job.fromJson(json);
      if (cache != null) {
        if (job.state == DeliveryState.delivered || job.state == DeliveryState.cancelled) {
          await cache.remove(_jobKey(id));
        } else {
          await cache.put(_jobKey(id), json);
        }
      }
      return job;
    } on ApiException catch (e) {
      if (e.code != ApiException.network || cache == null) rethrow;
      final hit = await cache.get(_jobKey(id));
      if (hit == null || hit.value is! Map) rethrow;
      _onState(hit.savedAt);
      return Job.fromJson(Map<String, dynamic>.from(hit.value! as Map));
    }
  }

  /// Keeps the home and each delivery in hand; drops the copies of deliveries that are no longer in hand.
  Future<void> _remember(JsonCache cache, Map<String, dynamic> home) async {
    final jobs = [for (final j in (home['jobs'] as List? ?? const [])) Map<String, dynamic>.from(j as Map)];
    final ids = [for (final j in jobs) j['id'] as String];
    final before = (await cache.get(_indexKey))?.value;
    for (final id in (before is List ? before : const []).whereType<String>()) {
      if (!ids.contains(id)) await cache.remove(_jobKey(id));
    }
    for (final j in jobs) {
      await cache.put(_jobKey(j['id'] as String), j);
    }
    await cache.put(_indexKey, ids);
    await cache.put(_homeKey, home);
  }
}
